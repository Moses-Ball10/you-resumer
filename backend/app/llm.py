"""Client for the language model.

Talks the OpenAI-compatible chat API, which both Ollama (development) and vLLM
(production) serve. Swapping in our own fine-tuned model later is a config change.
"""

import json
from collections.abc import AsyncIterator

import httpx

from .config import settings


class ModelUnavailable(Exception):
    pass


def _payload(messages: list[dict], stream: bool, temperature: float) -> dict:
    return {"model": settings.llm_model, "messages": messages, "stream": stream, "temperature": temperature}


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.llm_base_url,
        headers={"Authorization": f"Bearer {settings.llm_api_key}"},
        timeout=settings.llm_timeout_seconds,
    )


async def complete(messages: list[dict], temperature: float = 0.2) -> str:
    try:
        async with _client() as client:
            r = await client.post("/chat/completions", json=_payload(messages, False, temperature))
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
    except httpx.HTTPError as e:
        raise ModelUnavailable(str(e)) from e


async def stream(messages: list[dict], temperature: float = 0.2) -> AsyncIterator[str]:
    try:
        async with _client() as client:
            async with client.stream("POST", "/chat/completions", json=_payload(messages, True, temperature)) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    delta = json.loads(data)["choices"][0].get("delta", {}).get("content")
                    if delta:
                        yield delta
    except httpx.HTTPError as e:
        raise ModelUnavailable(str(e)) from e


async def is_available() -> bool:
    try:
        async with _client() as client:
            r = await client.get("/models", timeout=3)
            return r.status_code == 200
    except httpx.HTTPError:
        return False
