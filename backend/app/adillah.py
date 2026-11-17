"""Evidence (adillah) cited in a video: found by the AI, verified against the trusted texts.

The AI only points to the evidence (which verse, which hadith, who said it). The text shown
to the user always comes from the stored Qur'an and hadith collections. When a quote cannot
be matched there, it is shown as said in the video and marked as not verified.

The transcript is sent to the AI in ordered packets, so the first results show within seconds:
a small first packet, then larger ones. Sizes were measured on Arabic lectures: Gemini answers
in about 4 s for any of them, and Groq's free tier stops answering above about 4,000 characters.
"""

import json
import re
from dataclasses import dataclass

from . import sources
from .transcript import format_time

TYPES = ("ayah", "hadith", "athar", "qawl")
CORE_TYPES = ("ayah", "hadith", "athar")  # what makes a video worth analysing to the end

FIRST_PACKET_CHARS = 2_000  # about 3.5 minutes of speech: first colors in about 4 seconds
PACKET_CHARS = 4_000  # about 7.5 minutes: the largest size that both free providers handle
OVERLAP_LINES = 2  # repeated at the start of the next packet, so a quote on the boundary is not lost
LINE_SECONDS = 10  # one [m:ss] line of transcript every 10 seconds
PROBE_PACKETS = 2  # with no verse, hadith or athar in the first packets, stop (saves AI calls)

# Share of the speaker's words that must match the trusted text.
VERIFIED = 0.75  # the speaker quoted it correctly (small slips allowed)
CLOSE = 0.4  # the same text, quoted with different wording or from memory
LONG_MATCH = 10  # this many words in the same order is a match, even inside a longer quote with commentary


# ---------------------------------------------------------------- packets


@dataclass
class Line:
    start: float
    end: float
    text: str


@dataclass
class Packet:
    index: int
    start: float
    end: float
    text: str


def timed_lines(segments: list[dict]) -> list[Line]:
    """Transcript lines of about LINE_SECONDS each, each starting with its [m:ss] timestamp."""
    lines: list[Line] = []
    for i, seg in enumerate(segments):
        nxt = segments[i + 1]["start"] if i + 1 < len(segments) else seg["start"] + seg["duration"]
        if not lines or seg["start"] - lines[-1].start >= LINE_SECONDS:
            lines.append(Line(seg["start"], nxt, f"[{format_time(seg['start'])}] {seg['text']}"))
        else:
            lines[-1].text += " " + seg["text"]
            lines[-1].end = nxt
    return lines


def plan_packets(segments: list[dict]) -> list[Packet]:
    lines = timed_lines(segments)
    packets: list[Packet] = []
    i = 0
    while i < len(lines):
        budget = FIRST_PACKET_CHARS if not packets else PACKET_CHARS
        start = max(i - OVERLAP_LINES, 0) if packets else 0
        j, size = i, sum(len(lines[k].text) for k in range(start, i))
        while j < len(lines) and (j == i or size + len(lines[j].text) <= budget):
            size += len(lines[j].text) + 1
            j += 1
        chunk = lines[start:j]
        packets.append(Packet(len(packets), chunk[0].start, chunk[-1].end, "\n".join(l.text for l in chunk)))
        i = j
    return packets


# ---------------------------------------------------------------- the AI reply


def parse_items(reply: str) -> list[dict] | None:
    """The list of items in the model's JSON reply, or None when the reply is not valid JSON."""
    text = re.sub(r"^```(?:json)?|```$", "", reply.strip(), flags=re.MULTILINE).strip()
    for start, end in (("{", "}"), ("[", "]")):
        i, j = text.find(start), text.rfind(end)
        if i < 0 or j <= i:
            continue
        try:
            data = json.loads(text[i : j + 1])
        except json.JSONDecodeError:
            continue
        items = data.get("items") if isinstance(data, dict) else data
        if isinstance(items, list):
            return [x for x in items if isinstance(x, dict) and x.get("type") in TYPES and str(x.get("said", "")).strip()]
    return None


# ---------------------------------------------------------------- locating a quote in the captions


def _seconds(value) -> float | None:
    try:
        parts = [int(p) for p in str(value).strip().strip("[]").split(":")]
    except ValueError:
        return None
    total = 0
    for p in parts:
        total = total * 60 + p
    return float(total)


def _tokens(segments: list[dict], i: int, j: int) -> tuple[list[str], list[tuple[int, int]]]:
    """Stems of the caption words in segments i..j-1, and the (segment, word) each comes from.

    Words are the segment text split on whitespace, exactly as the page splits them.
    """
    flat, owner = [], []
    for si in range(i, j):
        for wi, token in enumerate(segments[si]["text"].split()):
            for stem in sources.stems(token):
                flat.append(stem)
                owner.append((si, wi))
    return flat, owner


def _locate(said: str, guess: float | None, segments: list[dict]) -> tuple[float, list[list[int]] | None]:
    """The time where the quote starts, and its first and last caption word as [segment, word]."""
    if not segments:
        return guess or 0.0, None
    want = len(sources.stems(said))
    near = [i for i, s in enumerate(segments) if guess is None or abs(s["start"] - guess) <= 90] or range(len(segments))
    best, best_score = None, 0.0
    for i in near:
        j, count = i, 0
        while j < len(segments) and count < want + 3 and j - i < 40:
            count += len(sources.stems(segments[j]["text"]))
            j += 1
        score = sources.match_score(said, " ".join(s["text"] for s in segments[i:j]))
        if score > best_score:
            best, best_score = (i, j), score
    if not best or best_score < 0.3:
        return (guess if guess is not None else 0.0), None
    i, j = best
    flat, owner = _tokens(segments, i, j)
    blocks = sources.matching_blocks(said, flat)
    if not blocks:
        return segments[i]["start"], None
    first = owner[blocks[0].b]
    last = owner[blocks[-1].b + blocks[-1].size - 1]
    return segments[first[0]]["start"], [list(first), list(last)]


def _correct_part(said: str, text: str) -> str | None:
    """The words of `text` (with tashkeel) that the speaker quoted, from the first to the last matched phrase."""
    tokens = text.split()
    flat, owner = [], []
    for k, token in enumerate(tokens):
        for stem in sources.stems(token):
            flat.append(stem)
            owner.append(k)
    blocks = sources.matching_blocks(said, flat)
    if not blocks or sum(b.size for b in blocks) < 0.5 * len(sources.stems(said)):
        return None
    a, b = owner[blocks[0].b], owner[blocks[-1].b + blocks[-1].size - 1]
    return " ".join(tokens[a : b + 1])


# ---------------------------------------------------------------- verifying


def _score(said: str, text: str) -> float:
    """Match score of the speaker's words; a long exact passage counts as verified."""
    fraction, count = sources.match_detail(said, text)
    return max(fraction, VERIFIED) if count >= LONG_MATCH else fraction


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


MIN_FRAGMENT_WORDS = 3  # a verse piece shorter than this is too likely to be ordinary speech
# Everyday phrases that also occur in the Qur'an; on their own they are speech, not a quoted verse.
FORMULAS = [
    "ان شاء الله", "بسم الله", "الحمد لله", "سبحان الله", "لا اله الا الله", "الله اكبر", "والله اعلم",
    "صلي الله عليه وسلم", "رضي الله عنه", "رضي الله عنهم", "عز وجل", "تبارك وتعالي", "سبحانه وتعالي",
]


def _only_formulas(fragment: str) -> bool:
    text = f" {sources.normalize(fragment)} "
    for f in FORMULAS:
        text = text.replace(f" {sources.normalize(f)} ", " ")
    return len(sources.stems(text)) < 2


def _ayah_item(said: str, ayat: "sources.Ayat", score: float) -> dict:
    out = {
        "type": "ayah",
        "said": said,
        "surah": ayat.surah,
        "surah_name": ayat.surah_name,
        "ayah_from": ayat.ayah_from,
        "ayah_to": ayat.ayah_to,
        "text": ayat.text,  # the whole verse, for the card and the PDF footnote
    }
    if not sources.has_arabic(said):
        out["status"] = "translated"  # quoted in another language: the reference comes from the AI
        return out
    out["status"] = "verified" if score >= VERIFIED else "different"
    # In the full text, only the words the speaker said, in the Uthmani spelling with tashkeel:
    # the transcript must not gain words that were not said.
    part = _correct_part(said, ayat.text)
    if part:
        out["correct_text"] = part
    return out


def _split_verses(said: str) -> list[tuple[str, "sources.Ayat"]]:
    """Verse pieces inside a quote that mixes verses with the speaker's commentary.

    Every run of words is looked up in the Qur'an (longest first); runs that match a verse
    exactly are kept, joined when they belong to the same verse, and the longer one wins
    when two overlap. The words between them are commentary.
    """
    ws = said.split()
    hits: list[tuple[int, int, sources.Ayat]] = []
    for i in range(len(ws)):
        for n in (10, 8, 6, 4, 3):
            if i + n > len(ws):
                continue
            fragment = " ".join(ws[i : i + n])
            if len(sources.stems(fragment)) < MIN_FRAGMENT_WORDS or _only_formulas(fragment):
                continue
            found = sources.search_quran(fragment)
            if found and found[1] >= 1.0:
                hits.append((i, i + n, found[0]))
                break
    # Join pieces of the same verse that touch or overlap.
    joined: list[list] = []
    for start, end, ayat in sorted(hits, key=lambda h: h[0]):
        last = next((j for j in reversed(joined) if j[2].surah == ayat.surah and j[2].ayah_from == ayat.ayah_from), None)
        if last and start <= last[1] + 1:
            last[1] = max(last[1], end)
        else:
            joined.append([start, end, ayat])
    # Keep the longest pieces; drop any that overlap a longer one.
    kept: list[list] = []
    for piece in sorted(joined, key=lambda j: j[1] - j[0], reverse=True):
        if all(piece[1] <= k[0] or piece[0] >= k[1] for k in kept):
            kept.append(piece)
    return [(" ".join(ws[a:b]), ayat) for a, b, ayat in sorted(kept, key=lambda k: k[0])]


def _verify_ayah(item: dict, said: str) -> list[dict]:
    """The verse(s) in a quote; empty when it matches no verse (it is then left as plain text)."""
    ayat = None
    surah, a_from, a_to = _int(item.get("surah")), _int(item.get("ayah_from")), _int(item.get("ayah_to"))
    if surah and a_from:
        ayat = sources.get_ayat(surah, a_from, a_to)
    if not sources.has_arabic(said):
        return [_ayah_item(said, ayat, 0.0)] if ayat else []
    # The plain share of matching words, without the long-passage allowance used for hadith:
    # a quote with commentary around the verse goes on to the splitting below.
    score = sources.match_score(said, ayat.clean) if ayat else 0.0
    if score >= VERIFIED:
        return [_ayah_item(said, ayat, score)]
    # The AI's reference may be wrong: look for the verse by the words themselves.
    found = sources.search_quran(said)
    if found and found[1] >= VERIFIED and found[1] > score:
        return [_ayah_item(said, found[0], found[1])]
    # Verses mixed with commentary: keep only the verse pieces.
    pieces = _split_verses(said)
    if pieces:
        return [_ayah_item(text, piece, 1.0) for text, piece in pieces]
    if ayat and score >= CLOSE:
        return [_ayah_item(said, ayat, score)]
    return []


def _verify_hadith(item: dict, said: str) -> dict:
    known = str(item.get("hadith_text") or "").strip()
    out: dict = {"type": "hadith", "said": said, "narrator": str(item.get("narrator") or "").strip()}
    found = sources.search_hadith(said, known)
    said_score = _score(said, found.text) if found else 0.0
    known_score = sources.match_score(known, found.text) if found and known else 0.0
    if found and (said_score >= CLOSE or (known_score >= VERIFIED and not sources.has_arabic(said))):
        out.update(
            collection=found.collection,
            collection_name=found.collection_name,
            number=found.number,
            full_text=found.text,
            grades=found.grades or ([{"by": "", "grade": "صحيح"}] if found.collection in ("bukhari", "muslim") else []),
            also_in=found.also_in,
        )
        if not sources.has_arabic(said):
            out["status"] = "translated"
        else:
            out["status"] = "verified" if said_score >= VERIFIED else "different"
            correct = _correct_part(said, found.text)
            if correct:
                out["correct_text"] = correct
    else:
        return None  # not in the nine collections: left out, and left as plain text
    return out


def verify_one(item: dict, segments: list[dict]) -> list[dict]:
    """Checks one item against the trusted texts and finds where it is said.

    Returns no item when a verse or hadith is not found in the sources (it stays plain text),
    and several when a quote mixes verses with commentary.
    """
    said = str(item["said"]).strip()
    kind = item["type"]
    if kind == "ayah":
        found = _verify_ayah(item, said)
    elif kind == "hadith":
        hadith = _verify_hadith(item, said)
        found = [hadith] if hadith else []
    else:
        found = [{"type": kind, "said": said, "person": str(item.get("person") or "").strip(), "status": "reported"}]
    guess = _seconds(item.get("time"))
    for out in found:
        time, span = _locate(out["said"], guess, segments)
        out["times"] = [time]
        if span:
            out["span"] = span
            # The correct wording of this place; a verse said twice may be quoted differently each time.
            out["span_text"] = out.get("correct_text", "")
    return found


def visible(items: list[dict]) -> list[dict]:
    """Items to show: analyses saved before this rule may still hold unrecognized ones."""
    return [i for i in items if i.get("status") != "unverified"]


def merge(items: list[dict]) -> list[dict]:
    """Merges repeats of the same evidence (keeping every moment it is said), ordered by time."""
    merged: dict[str, dict] = {}
    for item in visible(items):
        if item.get("surah"):
            key = f"ayah:{item['surah']}:{item['ayah_from']}:{item['ayah_to']}"
        elif item.get("collection"):
            key = f"hadith:{item['collection']}:{item['number']}"
        else:
            key = f"{item['type']}:{sources.normalize(item['said'])[:80]}"
        if key in merged:
            m = merged[key]
            for t in item["times"]:
                if all(abs(t - x) > 5 for x in m["times"]):
                    m["times"].append(t)
                    if item.get("span"):
                        m["spans"].append(item["span"])
                        m["span_texts"].append(item.get("span_text", ""))
        else:
            merged[key] = {
                **item,
                "times": list(item["times"]),
                "spans": [item["span"]] if item.get("span") else [],
                "span_texts": [item.get("span_text", "")] if item.get("span") else [],
            }
    out = sorted(merged.values(), key=lambda x: min(x["times"]))
    for x in out:
        x["times"] = sorted(x["times"])
        x["labels"] = [format_time(t) for t in x["times"]]
        # Every place the quote appears in the captions (for coloring the full text), with its wording.
        x.pop("span", None)
        x.pop("span_text", None)
    return out
