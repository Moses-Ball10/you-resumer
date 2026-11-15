"""Cutting transcripts into timestamped pieces and finding the relevant ones.

Search uses BM25 keyword matching for now. When the embedding model is installed,
`retrieve` is the single place to switch to vector search.
"""

import re
from dataclasses import dataclass

from rank_bm25 import BM25Okapi


@dataclass
class Chunk:
    video_id: str
    video_index: int  # 1-based position in the session, used as [V1], [V2] in answers
    start: float
    end: float
    text: str


def format_time(seconds: float) -> str:
    s = int(seconds)
    h, m, s = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def chunk_segments(video_id: str, video_index: int, segments: list[dict], chunk_seconds: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    texts: list[str] = []
    start = None
    end = 0.0
    for seg in segments:
        if start is None:
            start = seg["start"]
        texts.append(seg["text"])
        end = seg["start"] + seg["duration"]
        if end - start >= chunk_seconds:
            chunks.append(Chunk(video_id, video_index, start, end, " ".join(texts)))
            texts, start = [], None
    if texts and start is not None:
        chunks.append(Chunk(video_id, video_index, start, end, " ".join(texts)))
    return chunks


def full_text_with_times(segments: list[dict], every_seconds: int = 30) -> str:
    """Transcript text with a [m:ss] marker roughly every `every_seconds`, for summaries."""
    out: list[str] = []
    next_mark = 0.0
    for seg in segments:
        if seg["start"] >= next_mark:
            out.append(f"\n[{format_time(seg['start'])}] ")
            next_mark = seg["start"] + every_seconds
        out.append(seg["text"] + " ")
    return "".join(out).strip()


def _tokens(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def retrieve(chunks: list[Chunk], question: str, k: int) -> list[Chunk]:
    if len(chunks) <= k:
        return chunks
    bm25 = BM25Okapi([_tokens(c.text) for c in chunks])
    scores = bm25.get_scores(_tokens(question))
    ranked = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)
    # If nothing matches (e.g. a question in another language), spread picks across the video.
    if max(scores) <= 0:
        step = len(chunks) / k
        ranked = [int(i * step) for i in range(k)]
    picked = sorted(ranked[:k], key=lambda i: (chunks[i].video_index, chunks[i].start))
    return [chunks[i] for i in picked]
