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
    "transcript. Keep the exact names and terms the speaker uses; never rename them. "
    "Cite moments as [m:ss] using the timestamps in the transcript. Write in {language}."
)

SUMMARY_LANGUAGES = {"auto": "the same language as the transcript", "en": "English", "ar": "Arabic", "fr": "French"}


def summary_messages(title: str, transcript: str, style: str, language: str = "auto") -> list[dict]:
    return [
        {"role": "system", "content": _SUMMARY_SYSTEM.format(language=SUMMARY_LANGUAGES[language])},
        {
            "role": "user",
            "content": (
                f"Video title: {title or 'unknown'}\n\nTranscript:\n{transcript}\n\n{SUMMARY_STYLES[style]} "
                f"Write it in {SUMMARY_LANGUAGES[language]}."
            ),
        },
    ]


def partial_summary_messages(title: str, part: str, index: int, total: int) -> list[dict]:
    return [
        # Notes stay in the transcript's language; translation happens only in the final step.
        {"role": "system", "content": _SUMMARY_SYSTEM.format(language=SUMMARY_LANGUAGES["auto"])},
        {
            "role": "user",
            "content": (
                f"Video title: {title or 'unknown'}\nThis is part {index} of {total} of the transcript:\n{part}\n\n"
                "Write detailed notes of this part as bullets. Start each bullet with the [m:ss] timestamp "
                "where the point is made, and keep the exact names and terms the speaker uses."
            ),
        },
    ]


def search_query_messages(question: str, language: str) -> list[dict]:
    return [
        {
            "role": "user",
            "content": (
                f"Translate this question into the language with code '{language}'. "
                f"Reply with the translation only.\n\n{question}"
            ),
        }
    ]


_CHAT_SYSTEM = (
    "You answer questions about YouTube videos using only their transcript excerpts. "
    "You never use outside knowledge."
)

# Small models follow rules best when they sit right next to the question, so the
# excerpts and rules go in the final user message rather than the system prompt.
_CHAT_USER = """Videos:
{videos}

Transcript excerpts (each starts with [video start-end]):
{excerpts}

Question: {question}{translation}

Rules:
1. Read the excerpts carefully and answer only with what they say. Use the exact names and terms the speaker uses.
2. After each fact, cite where it is said as [V<number> m:ss], using the start time of that excerpt, for example [V1 3:15].
3. If the excerpts mention the topic, answer from them, even partially. Only if no excerpt is related to the question at all, say that the video does not cover it, with no citation.
4. Write your whole answer in the language of the question "{question}", even though the excerpts may be in another language.
5. Be concise."""


def chat_messages(
    videos: list[tuple[int, str]],
    chunks: list[Chunk],
    history: list[dict],
    question: str,
    translated: str | None = None,
) -> list[dict]:
    video_lines = "\n".join(f"V{i}: {title or 'untitled'}" for i, title in videos)
    excerpts = "\n\n".join(
        f"[V{c.video_index} {format_time(c.start)}-{format_time(c.end)}] {c.text}" for c in chunks
    )
    translation = f"\n(In the video's language: {translated})" if translated and translated != question else ""
    user = _CHAT_USER.format(videos=video_lines, excerpts=excerpts, question=question, translation=translation)
    return [{"role": "system", "content": _CHAT_SYSTEM}, *history[-6:], {"role": "user", "content": user}]


_ADILLAH_SYSTEM = (
    "You find the evidence (adillah) that a speaker cites in an Islamic talk, using only the transcript. "
    "You reply with JSON only."
)

_ADILLAH_USER = """Video title: {title}
This is part {index} of {total} of the transcript (parts overlap by a few lines). Lines start with a [m:ss] timestamp.

Transcript:
{part}

Find every piece of evidence the speaker quotes in this part:
- "ayah": a verse of the Qur'an that is recited or quoted. One item per verse: when the speaker quotes several
  verses with his own words between them (such as «أي النار», «وفي آية القصص», «وفي طه»), give each verse its own
  item, and put in "said" only the words of the Qur'an, never his commentary.
- "hadith": a saying or action of the Prophet ﷺ that is quoted.
- "athar": a saying of a Companion (sahabi) that is quoted.
- "qawl": a saying of a named scholar or righteous predecessor that is quoted: the imams (Ahmad, al-Shafi'i,
  Malik, Abu Hanifa), the Tabi'in (al-Hasan al-Basri, Sufyan al-Thawri, Sufyan ibn Uyayna, Maymun ibn Mihran...),
  and later scholars (Ibn Taymiyya, Ibn al-Qayyim, Ibn Rajab, Ibn al-Jawzi, al-Nawawi, Ibn Hajar, al-Baghawi...),
  including verses of poetry they said. Look for phrases such as «قال الإمام أحمد», «قال ابن القيم», «كان ... يقول», «ذكر ... عن».
- An athar or qawl counts even when it is short (one sentence) or quoted in the middle of the speaker's explanation.
Go through the transcript line by line and do not skip any quote. Skip only the speaker's own explanations,
and mentions of a person or book that do not quote anything.

Reply with JSON only, in this form: {{"items": [ ... ]}}, with one object per quote:
{{
  "type": "ayah" | "hadith" | "athar" | "qawl",
  "time": "m:ss" (the timestamp of the line where the quote starts),
  "said": "the quoted words exactly as written in the transcript, without the introduction such as قال الله تعالى or قال رسول الله",
  "surah": surah number, "ayah_from": first verse number, "ayah_to": last verse number   (ayah only),
  "hadith_text": "the well-known Arabic wording of the hadith as you know it"   (hadith only),
  "narrator": "the Companion who narrated it, if known"   (hadith only),
  "person": "who said it"   (athar and qawl only)
}}
If this part quotes no evidence, reply {{"items": []}}."""


def adillah_messages(title: str, part: str, index: int, total: int) -> list[dict]:
    user = _ADILLAH_USER.format(title=title or "unknown", part=part, index=index, total=total)
    return [{"role": "system", "content": _ADILLAH_SYSTEM}, {"role": "user", "content": user}]
