import json
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, delete, select

from . import adillah, llm, pdf, prompts, sources
from .config import settings
from .db import Adillah, AdillahPacket, Summary, Video, engine, get_session, init_db
from .transcript import chunk_segments, full_text_with_times, guess_language, parse_pasted, retrieve, shares_words
from .youtube import VideoError, extract_video_id, fetch_title, fetch_transcript

# Roughly what fits in a small model's context together with the instructions.
SUMMARY_PART_CHARS = 12_000


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="You Resumer API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.allowed_origins, allow_methods=["*"], allow_headers=["*"]
)


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _video_out(v: Video) -> dict:
    segs = v.segments
    return {
        "id": v.id,
        "title": v.title,
        "language": v.language,
        "source": v.source,
        "duration": round(segs[-1]["start"] + segs[-1]["duration"]) if segs else 0,
        "segments": segs,
    }


def _get_video(session: Session, video_id: str) -> Video:
    video = session.get(Video, video_id)
    if not video:
        raise _error(404, "not_loaded", "Load this video first.")
    return video


@app.get("/api/health")
async def health():
    return {"ok": True}


def visitor_keys(
    x_gemini_key: str = Header(default="", max_length=200),
    x_groq_key: str = Header(default="", max_length=200),
) -> llm.Keys:
    """The visitor's own AI keys, sent by their browser with each request and never stored."""
    return llm.Keys(gemini=x_gemini_key.strip(), groq=x_groq_key.strip())


# ---------------------------------------------------------------- limits for a public site

_hits: dict[tuple[str, str], deque] = defaultdict(deque)


def _visitor_ip(request: Request) -> str:
    # Behind Render's proxy the visitor's address is the first one in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _limit(request: Request, bucket: str, per_hour: int) -> None:
    """Allows `per_hour` requests of this kind per visitor in any 60 minutes."""
    hits = _hits[(bucket, _visitor_ip(request))]
    now = time.monotonic()
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= per_hour:
        minutes = int((3600 - (now - hits[0])) / 60) + 1
        raise _error(429, "too_many", f"Too many requests from you in the last hour. Please try again in {minutes} minutes.")
    hits.append(now)


def _ai_limit(request: Request) -> None:
    _limit(request, "ai", settings.ai_requests_per_hour)


def _check_length(segments: list[dict]) -> None:
    if segments and segments[-1]["start"] > settings.max_video_seconds:
        hours = settings.max_video_seconds / 3600
        raise VideoError("too_long", f"This video is too long. Videos up to {hours:g} hours are supported.")


def _save_video(session: Session, video_id: str, title: str, language: str, segments: list[dict], source: str) -> Video:
    video = Video(id=video_id, title=title, language=language, source=source, segments_json=json.dumps(segments))
    session.merge(video)
    session.commit()
    return session.get(Video, video_id)


class LoadVideoIn(BaseModel):
    url: str = Field(max_length=500)


@app.post("/api/videos")
async def load_video(body: LoadVideoIn, request: Request, session: Session = Depends(get_session)):
    try:
        video_id = extract_video_id(body.url)
        cached = session.get(Video, video_id)
        if cached:
            return _video_out(cached)
        _limit(request, "videos", settings.videos_per_hour)
        language, segments = await run_in_threadpool(fetch_transcript, video_id)
        _check_length(segments)
        title = await run_in_threadpool(fetch_title, video_id)
    except VideoError as e:
        raise _error(422, e.code, e.message)
    return _video_out(_save_video(session, video_id, title, language, segments, "captions"))


class PasteIn(BaseModel):
    url: str = Field(max_length=500)
    transcript: str = Field(min_length=10, max_length=600_000)


@app.post("/api/videos/paste")
async def paste_video(body: PasteIn, request: Request, session: Session = Depends(get_session)):
    """A video whose transcript the visitor copied from YouTube's "Show transcript" panel.

    Used when YouTube refuses our server: the visitor's own device is not blocked.
    """
    try:
        video_id = extract_video_id(body.url)
        _limit(request, "videos", settings.videos_per_hour)
        segments = parse_pasted(body.transcript)
        if len(segments) < 2:
            raise VideoError(
                "bad_transcript",
                "No timestamps found. Copy the transcript from YouTube's “Show transcript” panel, with its times.",
            )
        _check_length(segments)
        title = await run_in_threadpool(fetch_title, video_id)
    except VideoError as e:
        raise _error(422, e.code, e.message)
    return _video_out(_save_video(session, video_id, title, guess_language(segments), segments, "pasted"))


class SummaryIn(BaseModel):
    style: Literal["short", "detailed", "key_points", "chapters"] = "short"
    language: Literal["auto", "en", "ar", "fr"] = "auto"


def _event(**data) -> str:
    """One line of the progress stream: {"stage"}, {"model"}, {"token"}, {"done"}, {"error"} or {"needs_approval"}."""
    return json.dumps(data, ensure_ascii=False) + "\n"


_NO_KEY = {
    "code": "no_key",
    "message": "Add your free Gemini key (🔑 Your keys, at the top) to use the AI features.",
}


def _model_label(p: llm.Provider) -> str:
    return f"{p.label} · {p.model}"


def _model_error(e: Exception) -> dict:
    if isinstance(e, llm.NoProviders):
        return _NO_KEY
    if isinstance(e, llm.InvalidKey):
        who = getattr(e, "provider", "the AI provider")
        return {"code": "invalid_key", "message": f"{who} refused your key. Check it in 🔑 Your keys."}
    if isinstance(e, llm.RateLimited):
        return {"code": "rate_limited", "message": "Too many requests to the AI model right now. Please wait a minute and try again."}
    return {"code": "model_failed", "message": "The AI model stopped responding. Please try again."}


def _stream(events) -> StreamingResponse:
    # Streaming keeps the connection active during long model work, and lets the server notice
    # when the user cancels: the generator is then stopped, which closes the request to the model.
    # "no-transform" stops proxies (including Next.js gzip) from buffering the stream until it ends.
    return StreamingResponse(
        events,
        media_type="application/x-ndjson; charset=utf-8",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/api/videos/{video_id}/summary", dependencies=[Depends(_ai_limit)])
async def summarize(
    video_id: str, body: SummaryIn, session: Session = Depends(get_session), keys: llm.Keys = Depends(visitor_keys)
):
    video = _get_video(session, video_id)
    cached = session.get(Summary, (video_id, body.style, body.language))
    title, segments = video.title, video.segments

    async def events():
        if cached:
            if cached.model:
                yield _event(model=cached.model)
            yield _event(done=cached.content)
            return
        if not llm.is_configured(keys):
            yield _event(error=_NO_KEY)
            return
        yield _event(stage="Reading the transcript")
        transcript = full_text_with_times(segments)
        try:
            if len(transcript) > SUMMARY_PART_CHARS:
                # Long video: take notes on each part, then summarize the notes.
                parts = [transcript[i : i + SUMMARY_PART_CHARS] for i in range(0, len(transcript), SUMMARY_PART_CHARS)]
                notes = []
                for i, part in enumerate(parts, start=1):
                    yield _event(stage=f"Summarizing part {i} of {len(parts)}")
                    notes.append(await llm.complete(prompts.partial_summary_messages(title, part, i, len(parts)), keys))
                transcript = "\n\n".join(notes)
            yield _event(stage="Writing the summary")
            content = ""
            used: list[llm.Provider] = []
            async for token in llm.stream(
                prompts.summary_messages(title, transcript, body.style, body.language), keys, used=used
            ):
                if not content and used:
                    yield _event(model=_model_label(used[-1]))
                content += token
                yield _event(token=token)
        except llm.ModelUnavailable as e:
            yield _event(error=_model_error(e))
            return
        content = content.strip()
        with Session(engine) as s:
            model = _model_label(used[-1]) if used else ""
            s.merge(Summary(video_id=video_id, style=body.style, language=body.language, content=content, model=model))
            s.commit()
        yield _event(done=content)

    return _stream(events())


@app.delete("/api/videos/{video_id}/summary")
async def clear_summary(
    video_id: str,
    style: Literal["short", "detailed", "key_points", "chapters"] | None = None,
    language: Literal["auto", "en", "ar", "fr"] | None = None,
    session: Session = Depends(get_session),
):
    """Delete saved summaries so the next request generates a fresh one.

    With style and language: only that summary. Without them: every summary of the video.
    """
    query = delete(Summary).where(Summary.video_id == video_id)
    if style:
        query = query.where(Summary.style == style)
    if language:
        query = query.where(Summary.language == language)
    deleted = session.exec(query).rowcount
    session.commit()
    return {"deleted": deleted}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    video_ids: list[str] = Field(min_length=1)
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = []


@app.post("/api/chat", dependencies=[Depends(_ai_limit)])
async def chat(body: ChatIn, session: Session = Depends(get_session), keys: llm.Keys = Depends(visitor_keys)):
    if len(body.video_ids) > settings.max_videos_per_session:
        raise _error(400, "too_many_videos", f"You can ask about up to {settings.max_videos_per_session} videos at once.")

    videos = [_get_video(session, vid) for vid in body.video_ids]
    chunks = [
        c
        for i, v in enumerate(videos, start=1)
        for c in chunk_segments(v.id, i, v.segments, settings.chunk_seconds)
    ]
    titles = [(i, v.title) for i, v in enumerate(videos, start=1)]
    languages = [v.language for v in videos]
    history = [m.model_dump() for m in body.history]

    async def events():
        if not llm.is_configured(keys):
            yield _event(error=_NO_KEY)
            return
        yield _event(stage="Searching the video" if len(videos) == 1 else "Searching the videos")
        # Make sure every video gets a share of the context, not only the best-matching one.
        per_video = max(2, settings.max_context_chunks // len(videos))
        context: list = []
        translated: str | None = None
        try:
            for i, language in enumerate(languages, start=1):
                video_chunks = [c for c in chunks if c.video_index == i]
                query = body.question
                if not shares_words(video_chunks, query) and language:
                    # Question likely in another language than the video: translate it for keyword search.
                    # This goes away once vector search with a multilingual embedding model is in place.
                    yield _event(stage="Translating the question")
                    query = await llm.complete(
                        prompts.search_query_messages(body.question, language), keys
                    )
                    translated = translated or query
                context.extend(retrieve(video_chunks, query, per_video))
            yield _event(stage="Writing the answer")
            messages = prompts.chat_messages(titles, context, history, body.question, translated)
            used: list[llm.Provider] = []
            first = True
            async for token in llm.stream(messages, keys, used=used):
                if first and used:
                    yield _event(model=_model_label(used[-1]))
                first = False
                yield _event(token=token)
        except llm.ModelUnavailable as e:
            yield _event(error=_model_error(e))
            return
        yield _event(done=True)

    return _stream(events())


class AdillahIn(BaseModel):
    force: bool = False  # continue even after the first packets found no evidence


async def _find_evidence(title: str, packet: adillah.Packet, total: int, keys: llm.Keys, used: list) -> list[dict]:
    messages = prompts.adillah_messages(title, packet.text, packet.index + 1, total)
    for _ in range(2):  # one retry when the reply is not valid JSON
        items = adillah.parse_items(await llm.complete(messages, keys, temperature=0, used=used))
        if items is not None:
            return items
    raise llm.ModelUnavailable("the reply was not valid JSON")


def _adillah_state(items: list[dict], state: str, analysed: float, duration: float, packet: int, packets: int) -> dict:
    return {"items": items, "state": state, "analysed": analysed, "duration": duration, "packet": packet, "packets": packets}


@app.post("/api/videos/{video_id}/adillah", dependencies=[Depends(_ai_limit)])
async def find_adillah(
    video_id: str, body: AdillahIn, session: Session = Depends(get_session), keys: llm.Keys = Depends(visitor_keys)
):
    """Every verse, hadith, athar and scholar's saying quoted in the video, verified against the sources.

    The transcript goes to the AI one packet at a time, in order. After each packet the stream
    sends {"packet": state} with every item found so far, so the page can show them at once.
    Finished packets are saved: a later request resumes where the last one stopped.
    """
    video = _get_video(session, video_id)
    title, segments = video.title, video.segments
    duration = segments[-1]["start"] + segments[-1]["duration"] if segments else 0
    packets = adillah.plan_packets(segments)
    row = session.get(Adillah, video_id)
    done_packets = session.exec(
        select(AdillahPacket).where(AdillahPacket.video_id == video_id).order_by(AdillahPacket.index)
    ).all()
    found: list[dict] = [i for p in done_packets for i in json.loads(p.items_json)]
    analysed = done_packets[-1].end if done_packets else 0.0
    model = row.model if row else ""

    async def events():
        nonlocal analysed, model
        if row and (row.state == "complete" or (row.state == "no_adillah" and not body.force)):
            if row.model:
                yield _event(model=row.model)
            end = duration if row.state == "complete" else row.analysed
            yield _event(done=_adillah_state(adillah.visible(json.loads(row.items_json)), row.state, end, duration, len(done_packets), len(packets)))
            return
        if found:
            if model:
                yield _event(model=model)
            yield _event(packet=_adillah_state(adillah.merge(found), "partial", analysed, duration, len(done_packets), len(packets)))
        if not llm.is_configured(keys):
            yield _event(error=_NO_KEY)
            return
        if not sources.is_ready():
            yield _event(stage="Downloading the Qur'an and hadith collections (first time only)")
            try:
                await run_in_threadpool(sources.build)
            except Exception:
                yield _event(error={"code": "sources_failed", "message": "Could not download the Qur'an and hadith data. Please try again."})
                return

        for packet in packets[len(done_packets) :]:
            if (
                not body.force
                and packet.index >= adillah.PROBE_PACKETS
                and not any(i["type"] in adillah.CORE_TYPES for i in found)
            ):
                # Nothing Islamic in the first minutes: stop here instead of spending AI calls on the rest.
                items = adillah.merge(found)
                _save_adillah(video_id, items, model, "no_adillah", analysed)
                yield _event(done=_adillah_state(items, "no_adillah", analysed, duration, packet.index, len(packets)))
                return
            yield _event(
                stage=f"Analysing {adillah.format_time(packet.start)}–{adillah.format_time(packet.end)} "
                f"(part {packet.index + 1} of {len(packets)})"
            )
            used: list[llm.Provider] = []
            try:
                raw = await _find_evidence(title, packet, len(packets), keys, used)
            except llm.ModelUnavailable as e:
                yield _event(error=_model_error(e))
                return
            verified = await run_in_threadpool(lambda: [x for i in raw for x in adillah.verify_one(i, segments)])
            found.extend(verified)
            analysed = packet.end
            if used:
                model = _model_label(used[-1])
                yield _event(model=model)
            with Session(engine) as s:
                s.merge(
                    AdillahPacket(
                        video_id=video_id, index=packet.index, end=packet.end,
                        items_json=json.dumps(verified, ensure_ascii=False),
                    )
                )
                s.commit()
            items = adillah.merge(found)
            last = packet.index == len(packets) - 1
            _save_adillah(video_id, items, model, "complete" if last else "partial", analysed)
            if not last:
                yield _event(packet=_adillah_state(items, "partial", analysed, duration, packet.index + 1, len(packets)))
        items = adillah.merge(found)
        _save_adillah(video_id, items, model, "complete", duration)
        yield _event(done=_adillah_state(items, "complete", duration, duration, len(packets), len(packets)))

    return _stream(events())


def _save_adillah(video_id: str, items: list[dict], model: str, state: str, analysed: float) -> None:
    with Session(engine) as s:
        s.merge(
            Adillah(
                video_id=video_id, items_json=json.dumps(items, ensure_ascii=False),
                model=model, state=state, analysed=analysed,
            )
        )
        s.commit()


@app.delete("/api/videos/{video_id}/adillah")
async def clear_adillah(video_id: str, session: Session = Depends(get_session)):
    """Delete the saved evidence list and packets so the next request analyses the video again."""
    deleted = session.exec(delete(Adillah).where(Adillah.video_id == video_id)).rowcount
    session.exec(delete(AdillahPacket).where(AdillahPacket.video_id == video_id))
    session.commit()
    return {"deleted": deleted}


class PdfRun(BaseModel):
    k: Literal["t", "q"]
    text: str = Field(max_length=20_000)
    item: int | None = None  # quotes: index into `items`
    original: str = ""
    corrected: bool = False


class PdfIn(BaseModel):
    title: str = Field(default="", max_length=300)
    speaker: str = Field(default="", max_length=200)
    url: str = Field(default="", max_length=300)
    duration: float = 0
    rtl: bool = True
    items: list[dict] = []
    paragraphs: list[list[PdfRun]]


@app.post("/api/export/pdf", dependencies=[Depends(_ai_limit)])
async def export_pdf(body: PdfIn):
    """The organized transcript as a PDF: cover, colored quotes with references and footnotes, indexes."""
    for para in body.paragraphs:
        for r in para:
            if r.k == "q" and (r.item is None or not 0 <= r.item < len(body.items)):
                raise _error(422, "bad_quote", "A quote points to an unknown evidence item.")
    try:
        data = await run_in_threadpool(pdf.render, body.model_dump())
    except Exception:
        llm.log.exception("PDF export failed")
        raise _error(500, "pdf_failed", "Could not create the PDF. Please try again.")
    return Response(content=data, media_type="application/pdf")
