import json
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from . import llm, prompts
from .config import settings
from .db import Summary, Video, get_session, init_db
from .transcript import chunk_segments, full_text_with_times, retrieve
from .youtube import VideoError, extract_video_id, fetch_title, fetch_transcript

# Roughly what fits in a small model's context together with the instructions.
SUMMARY_PART_CHARS = 12_000


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="You Resumer API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"]
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
    return {"ok": True, "model_available": await llm.is_available(), "model": settings.llm_model}


class LoadVideoIn(BaseModel):
    url: str


@app.post("/api/videos")
async def load_video(body: LoadVideoIn, session: Session = Depends(get_session)):
    try:
        video_id = extract_video_id(body.url)
        cached = session.get(Video, video_id)
        if cached:
            return _video_out(cached)
        language, segments = await run_in_threadpool(fetch_transcript, video_id)
        title = await run_in_threadpool(fetch_title, video_id)
    except VideoError as e:
        raise _error(422, e.code, e.message)

    video = Video(id=video_id, title=title, language=language, segments_json=json.dumps(segments))
    session.add(video)
    session.commit()
    session.refresh(video)
    return _video_out(video)


class SummaryIn(BaseModel):
    style: Literal["short", "detailed", "key_points", "chapters"] = "short"


@app.post("/api/videos/{video_id}/summary")
async def summarize(video_id: str, body: SummaryIn, session: Session = Depends(get_session)):
    video = _get_video(session, video_id)
    cached = session.get(Summary, (video_id, body.style))
    if cached:
        return {"style": body.style, "content": cached.content, "cached": True}

    transcript = full_text_with_times(video.segments)
    try:
        if len(transcript) > SUMMARY_PART_CHARS:
            # Long video: take notes on each part, then summarize the notes.
            parts = [transcript[i : i + SUMMARY_PART_CHARS] for i in range(0, len(transcript), SUMMARY_PART_CHARS)]
            notes = [
                await llm.complete(prompts.partial_summary_messages(video.title, p, i + 1, len(parts)))
                for i, p in enumerate(parts)
            ]
            transcript = "\n\n".join(notes)
        content = await llm.complete(prompts.summary_messages(video.title, transcript, body.style))
    except llm.ModelUnavailable:
        raise _error(503, "model_unavailable", "The AI model is not available right now. Please try again later.")

    session.add(Summary(video_id=video_id, style=body.style, content=content))
    session.commit()
    return {"style": body.style, "content": content, "cached": False}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    video_ids: list[str] = Field(min_length=1)
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = []


@app.post("/api/chat")
async def chat(body: ChatIn, session: Session = Depends(get_session)):
    if len(body.video_ids) > settings.max_videos_per_session:
        raise _error(400, "too_many_videos", f"You can ask about up to {settings.max_videos_per_session} videos at once.")

    videos = [_get_video(session, vid) for vid in body.video_ids]
    chunks = [
        c
        for i, v in enumerate(videos, start=1)
        for c in chunk_segments(v.id, i, v.segments, settings.chunk_seconds)
    ]
    # Make sure every video gets a share of the context, not only the best-matching one.
    per_video = max(2, settings.max_context_chunks // len(videos))
    context = [
        c
        for i in range(1, len(videos) + 1)
        for c in retrieve([c for c in chunks if c.video_index == i], body.question, per_video)
    ]
    messages = prompts.chat_messages(
        [(i, v.title) for i, v in enumerate(videos, start=1)],
        context,
        [m.model_dump() for m in body.history],
        body.question,
    )

    if not await llm.is_available():
        raise _error(503, "model_unavailable", "The AI model is not available right now. Please try again later.")

    async def generate():
        try:
            async for token in llm.stream(messages):
                yield token
        except llm.ModelUnavailable:
            yield "\n\n[The AI model stopped responding. Please try again.]"

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")
