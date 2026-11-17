"""Client for the language models.

Every provider speaks the OpenAI-compatible chat API, so they are interchangeable.
The keys come from each visitor (they are stored in their browser and sent with each
request); the server keeps no AI key of its own. Requests try the providers in order:
when one is busy or failing, the next one is tried. Every provider is free to use.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from .config import settings

log = logging.getLogger("uvicorn.error")


class ModelUnavailable(Exception):
    pass


class RateLimited(ModelUnavailable):
    """The provider's request or token limit was reached (HTTP 429)."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class Overloaded(ModelUnavailable):
    """The provider is temporarily overloaded (HTTP 5xx); a second try often works."""


class InvalidKey(ModelUnavailable):
    """The provider refused the key (wrong, revoked, or not allowed)."""


class NoProviders(ModelUnavailable):
    """The visitor has not added any key."""


@dataclass(frozen=True)
class Keys:
    """The visitor's own API keys."""

    gemini: str = ""
    groq: str = ""


@dataclass(frozen=True)
class Provider:
    name: str
    label: str
    base_url: str
    api_key: str
    model: str


def providers(keys: Keys) -> list[Provider]:
    """The providers this visitor can use, in the order they are tried."""
    s = settings
    found = [
        # Our own OpenAI-compatible server (vLLM), if one is configured on the server.
        Provider("custom", "Our server", s.custom_base_url, s.custom_api_key, s.custom_model),
        Provider("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", keys.gemini, s.gemini_model),
        Provider("groq", "Groq", "https://api.groq.com/openai/v1", keys.groq, s.groq_model),
    ]
    return [p for p in found if p.api_key and p.base_url and p.model]


def _check(r: httpx.Response) -> None:
    if r.status_code in (400, 401, 403) and any(w in r.text.lower() for w in ("api key", "api_key", "invalid", "permission", "unauthorized")):
        raise InvalidKey(f"key refused ({r.status_code})")
    if r.status_code == 429:
        try:
            retry_after = float(r.headers.get("retry-after", ""))
        except ValueError:
            retry_after = None
        raise RateLimited("rate limited", retry_after)
    if r.status_code >= 500:
        raise Overloaded(f"server error {r.status_code}")
    r.raise_for_status()


# One short wait and retry on the same provider before moving to the next one.
MAX_RETRY_WAIT = 15


def _retry_wait(err: ModelUnavailable) -> float | None:
    if isinstance(err, Overloaded):
        return 2
    if isinstance(err, RateLimited) and err.retry_after is not None and err.retry_after <= MAX_RETRY_WAIT:
        return err.retry_after + 0.5
    return None


def _payload(p: Provider, messages: list[dict], stream: bool, temperature: float) -> dict:
    return {"model": p.model, "messages": messages, "stream": stream, "temperature": temperature}


def _client(p: Provider) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=p.base_url,
        headers={"Authorization": f"Bearer {p.api_key}"},
        timeout=settings.llm_timeout_seconds,
    )


async def _complete_one(p: Provider, messages: list[dict], temperature: float) -> str:
    async def call() -> str:
        async with _client(p) as client:
            r = await client.post("/chat/completions", json=_payload(p, messages, False, temperature))
            _check(r)
            return (r.json()["choices"][0]["message"].get("content") or "").strip()

    try:
        return await asyncio.wait_for(call(), settings.llm_complete_seconds)
    except TimeoutError as e:
        raise ModelUnavailable("timed out") from e
    except httpx.HTTPError as e:
        raise ModelUnavailable(str(e)) from e
    except (KeyError, IndexError, ValueError) as e:
        raise ModelUnavailable(f"unexpected response: {e}") from e


async def _stream_one(p: Provider, messages: list[dict], temperature: float) -> AsyncIterator[str]:
    try:
        async with _client(p) as client:
            async with client.stream("POST", "/chat/completions", json=_payload(p, messages, True, temperature)) as r:
                if r.status_code >= 400:
                    await r.aread()
                _check(r)
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    choices = json.loads(data).get("choices") or [{}]
                    delta = choices[0].get("delta", {}).get("content")
                    if delta:
                        yield delta
    except httpx.HTTPError as e:
        raise ModelUnavailable(str(e)) from e


def _keep(last: ModelUnavailable, err: ModelUnavailable, p: Provider) -> ModelUnavailable:
    """The error to report if every provider fails: a refused key matters most to the visitor."""
    if isinstance(err, InvalidKey):
        err.provider = p.label
    return last if isinstance(last, InvalidKey) else err


def _fallback(p: Provider, err: Exception) -> None:
    log.warning("AI provider %s failed (%s: %s); trying the next one", p.name, type(err).__name__, str(err)[:200])


async def complete(
    messages: list[dict], keys: Keys, temperature: float = 0.1, used: list[Provider] | None = None
) -> str:
    """`used`, when given, receives the provider that answered."""
    last: ModelUnavailable = NoProviders("no AI key added")
    try:
        for p in providers(keys):
            for attempt in range(2):
                try:
                    text = await _complete_one(p, messages, temperature)
                    if used is not None:
                        used.append(p)
                    return text
                except ModelUnavailable as e:
                    last = _keep(last, e, p)
                    wait = _retry_wait(e) if attempt == 0 else None
                    if wait is None:
                        _fallback(p, e)
                        break
                    log.info("AI provider %s is busy; retrying in %.0f s", p.name, wait)
                    await asyncio.sleep(wait)
    except asyncio.CancelledError:
        # The user cancelled: leaving the "async with" closes the connection, and the model stops.
        log.info("Model request cancelled by the user")
        raise
    raise last


async def stream(
    messages: list[dict], keys: Keys, temperature: float = 0.1, used: list[Provider] | None = None
) -> AsyncIterator[str]:
    """`used`, when given, receives the provider that answered, before its first token is yielded."""
    last: ModelUnavailable = NoProviders("no AI key added")
    try:
        for p in providers(keys):
            started = False
            tokens = _stream_one(p, messages, temperature)
            try:
                # A provider that does not start answering in time is skipped.
                try:
                    first = await asyncio.wait_for(anext(tokens), settings.llm_first_token_seconds)
                except StopAsyncIteration:
                    return
                except TimeoutError as e:
                    await tokens.aclose()
                    raise ModelUnavailable("timed out") from e
                started = True
                if used is not None:
                    used.append(p)
                yield first
                async for token in tokens:
                    yield token
                return
            except ModelUnavailable as e:
                if started:  # part of the answer was already sent; switching now would mix two answers
                    raise
                _fallback(p, e)
                last = _keep(last, e, p)
    except (asyncio.CancelledError, GeneratorExit):
        log.info("Model stream cancelled by the user")
        raise
    raise last


def is_configured(keys: Keys) -> bool:
    return bool(providers(keys))
