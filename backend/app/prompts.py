"""All instructions given to the model live here, so they are easy to tune."""

from .transcript import Chunk, format_time

SUMMARY_STYLES = {
    "short": "Write a short summary of 3 to 5 sentences.",
    "detailed": "Write a detailed summary organized in paragraphs, covering every main point in order.",
    "key_points": "Write the key points as a bullet list, one idea per bullet.",
    "chapters": (
        "Split the video into chapters. Output one chapter per line in the format "
        "'[m:ss] Chapter title', using the timestamps from the transcript."
    ),
}

_SUMMARY_SYSTEM = (
    "You summarize YouTube videos using only their transcript. Do not add facts that are not in the "
    "transcript. Where helpful, cite moments as [m:ss] using the timestamps in the transcript. "
    "Write in {language}."
)

_LANGUAGE_RULE = "the same language as the transcript"


def summary_messages(title: str, transcript: str, style: str) -> list[dict]:
    return [
        {"role": "system", "content": _SUMMARY_SYSTEM.format(language=_LANGUAGE_RULE)},
        {
            "role": "user",
            "content": f"Video title: {title or 'unknown'}\n\nTranscript:\n{transcript}\n\n{SUMMARY_STYLES[style]}",
        },
    ]


def partial_summary_messages(title: str, part: str, index: int, total: int) -> list[dict]:
    return [
        {"role": "system", "content": _SUMMARY_SYSTEM.format(language=_LANGUAGE_RULE)},
        {
            "role": "user",
            "content": (
                f"Video title: {title or 'unknown'}\nThis is part {index} of {total} of the transcript:\n{part}\n\n"
                "Write detailed notes of this part as bullets, keeping the [m:ss] timestamps of each point."
            ),
        },
    ]


_CHAT_SYSTEM = """You answer questions about YouTube videos using ONLY the transcript excerpts below.

Rules:
- Use only information from the excerpts. Never use outside knowledge.
- If the excerpts do not contain the answer, say clearly that the video does not cover it.
- After each claim, cite its source as [V<number> m:ss], for example [V1 3:15].
- Answer in the language the user asks in, even if the video is in another language.
- Be concise.

Videos:
{videos}

Transcript excerpts:
{excerpts}"""


def chat_messages(videos: list[tuple[int, str]], chunks: list[Chunk], history: list[dict], question: str) -> list[dict]:
    video_lines = "\n".join(f"V{i}: {title or 'untitled'}" for i, title in videos)
    excerpts = "\n\n".join(
        f"[V{c.video_index} {format_time(c.start)}-{format_time(c.end)}] {c.text}" for c in chunks
    )
    system = _CHAT_SYSTEM.format(videos=video_lines, excerpts=excerpts)
    return [{"role": "system", "content": system}, *history[-6:], {"role": "user", "content": question}]
