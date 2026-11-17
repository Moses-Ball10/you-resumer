"""Fetching video ids, titles and transcripts from YouTube."""

import re

import httpx
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    IpBlocked,
    RequestBlocked,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

_ID_PATTERNS = [
    r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([A-Za-z0-9_-]{11})",
    r"^([A-Za-z0-9_-]{11})$",
]


class VideoError(Exception):
    """A problem the user should see, with a stable code for the frontend."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def extract_video_id(url_or_id: str) -> str:
    text = url_or_id.strip()
    for pattern in _ID_PATTERNS:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    raise VideoError("invalid_url", "This does not look like a YouTube link.")


def fetch_title(video_id: str) -> str:
    try:
        r = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=10,
        )
        if r.status_code == 200:
            return r.json().get("title", "")
    except httpx.HTTPError:
        pass
    return ""


def _base_lang(code: str) -> str:
    return code.split("-")[0].lower()


def _pick_track(tracks: list):
    """Choose the caption track in the language actually spoken in the video.

    Videos like TED talks carry dozens of human-made translations, so "first manual
    track" can be a translation. YouTube auto-generates captions only in the spoken
    language, which tells us what that language is.
    """
    if not tracks:
        return None
    manual = [t for t in tracks if not t.is_generated]
    generated = [t for t in tracks if t.is_generated]
    if generated:
        spoken = _base_lang(generated[0].language_code)
        same_lang = [t for t in manual if _base_lang(t.language_code) == spoken]
        return same_lang[0] if same_lang else generated[0]
    if len(manual) == 1:
        return manual[0]
    # Several manual tracks and no hint of the spoken language: English is most likely the original.
    english = [t for t in manual if _base_lang(t.language_code) == "en"]
    return english[0] if english else manual[0]


def fetch_transcript(video_id: str) -> tuple[str, list[dict]]:
    """Return (language_code, segments) in the video's spoken language when possible."""
    api = YouTubeTranscriptApi()
    try:
        chosen = _pick_track(list(api.list(video_id)))
        if chosen is None:
            raise NoTranscriptFound(video_id, [], transcripts)
        fetched = chosen.fetch()
    except (TranscriptsDisabled, NoTranscriptFound):
        raise VideoError(
            "no_captions",
            "This video has no captions. Support for videos without captions is coming soon.",
        )
    except VideoUnavailable:
        raise VideoError("unavailable", "This video is unavailable or private.")
    except (RequestBlocked, IpBlocked):
        # YouTube refuses many requests from hosting providers' servers (it takes them for bots).
        raise VideoError(
            "blocked",
            "YouTube refused to give our server this video's captions. Paste the transcript instead.",
        )
    except VideoError:
        raise
    except Exception as e:  # network blocks, YouTube changes, etc.
        raise VideoError("fetch_failed", f"Could not read this video's transcript ({type(e).__name__}).")

    segments = [
        {"start": round(s.start, 2), "duration": round(s.duration, 2), "text": s.text.replace("\n", " ").strip()}
        for s in fetched.snippets
        if s.text.strip()
    ]
    if not segments:
        raise VideoError("no_captions", "This video's captions are empty.")
    return chosen.language_code, segments
