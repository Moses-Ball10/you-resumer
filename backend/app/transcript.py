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


def shares_words(chunks: list[Chunk], question: str) -> bool:
    """True if any question word appears in the transcript (e.g. False for an Arabic question on an English video)."""
    words = set(_tokens(question))
    return any(words & set(_tokens(c.text)) for c in chunks)


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


# A timestamp at the start of a line: "0:05", "12:30", "1:02:03".
_STAMP = re.compile(r"^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b\s*(.*)$")
# Accessibility labels YouTube adds under each timestamp when the transcript is copied.
_SPOKEN_TIME = re.compile(
    r"^\s*(\d+\s*(seconds?|minutes?|hours?|ثانية|ثوان|ثواني|ثوانٍ|دقيقة|دقيقتان|دقيقتين|دقائق|ساعة|ساعات)[,،\s]*)+$",
    re.IGNORECASE,
)


def parse_pasted(text: str) -> list[dict]:
    """Segments from a transcript copied from YouTube's "Show transcript" panel.

    Accepts a timestamp alone on its line followed by the text, or both on the same line.
    """
    entries: list[list] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or _SPOKEN_TIME.match(line):
            continue
        m = _STAMP.match(line)
        if m:
            h, mnt, sec, rest = m.groups()
            entries.append([int(h or 0) * 3600 + int(mnt) * 60 + int(sec), rest.strip()])
        elif entries:
            entries[-1][1] = (entries[-1][1] + " " + line).strip()
    entries = [e for e in entries if e[1]]
    segments = []
    for i, (start, words) in enumerate(entries):
        end = entries[i + 1][0] if i + 1 < len(entries) else start + max(2, len(words) / 12)
        segments.append({"start": float(start), "duration": round(max(end - start, 0.5), 2), "text": words})
    return segments


def guess_language(segments: list[dict]) -> str:
    sample = " ".join(s["text"] for s in segments[:200])
    arabic = sum(1 for c in sample if "\u0600" <= c <= "\u06ff")
    letters = sum(1 for c in sample if c.isalpha()) or 1
    return "ar" if arabic / letters > 0.5 else "en"
