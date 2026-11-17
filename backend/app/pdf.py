"""The organized PDF of a video's transcript (تفريغ), without any AI.

The page sends the text as it shows it: paragraphs of plain text and quotes, each quote pointing
to its evidence item. This module adds what a printed transcript needs (references after verses,
footnotes with the source and grade of each hadith, and indexes of verses, hadith and athar) and
typesets it with Typst, using the Amiri fonts stored in `backend/fonts`.
"""

import json
from datetime import date
from pathlib import Path

import typst

from . import sources
from .transcript import format_time

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "templates" / "tafrigh.typ"
FONTS = ROOT.parent / "fonts"

# How a collection is named after "أخرجه".
AUTHORS = {
    "bukhari": "البخاري",
    "muslim": "مسلم",
    "abudawud": "أبو داود",
    "tirmidhi": "الترمذي",
    "nasai": "النسائي",
    "ibnmajah": "ابن ماجه",
    "malik": "مالك في الموطأ",
    "nawawi": "النووي في الأربعين",
    "qudsi": "في الأحاديث القدسية",
}
NINE_BOOKS = "الكتب التسعة (البخاري، ومسلم، وأبي داود، والترمذي، والنسائي، وابن ماجه، وموطأ مالك، والأربعين النووية، والأحاديث القدسية)"


def digits(n) -> str:
    return str(n).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))


def _surah(name: str) -> str:
    """"سُورَةُ النَّازِعَاتِ" -> "النَّازِعَاتِ"."""
    parts = name.split(" ", 1)
    return parts[1] if len(parts) == 2 and sources.normalize(parts[0]) == "سوره" else name


def _ayah_ref(item: dict) -> str:
    a, b = item.get("ayah_from"), item.get("ayah_to")
    verses = digits(a) if not b or b == a else f"{digits(a)}–{digits(b)}"
    return f"{_surah(item.get('surah_name', ''))}: {verses}"


def _hadith_note(item: dict, original: str, corrected: bool) -> str:
    status = item.get("status")
    if status == "unverified" or not item.get("collection"):
        return f"لم أقف عليه في {NINE_BOOKS}."
    parts = [f"أخرجه {AUTHORS.get(item['collection'], item.get('collection_name', ''))} ({digits(item.get('number', ''))})"]
    for other in item.get("also_in") or []:
        parts.append(f"و{AUTHORS.get(other['collection'], other['collection_name'])} ({digits(other['number'])})")
    note = "، ".join(parts) + "."
    graded = [g for g in item.get("grades") or [] if g.get("by")]
    if graded:
        note += " " + "، ".join(f"وحكم عليه {g['by']}: {g['grade']}" for g in graded) + "."
    elif item["collection"] in ("bukhari", "muslim"):
        note += " والحديث صحيح."
    if item.get("narrator"):
        note += f" الراوي: {item['narrator']}."
    if status == "translated":
        note += " ذُكر في المقطع بالمعنى."
    if corrected:
        note += f" ولفظه في المقطع: «{original}»."
    return note


def _without_numbers(text: str) -> str:
    return " ".join(w for w in text.split() if not w.startswith("﴿") and not w.endswith("﴾"))


def _words_of(text: str) -> list[str]:
    return sources.stems(_without_numbers(text))


def _excerpt(text: str, n: int = 9) -> str:
    """The first words of a text, without verse-number markers."""
    clean = " ".join(w for w in text.split() if not w.startswith("﴿") and not w.endswith("﴾"))
    words = clean.split()
    return " ".join(words[:n]) + (" …" if len(words) > n else "")


def build_data(body: dict) -> dict:
    items: list[dict] = body["items"]
    rtl = bool(body.get("rtl", True))
    first_key: dict[int, str] = {}
    paragraphs = []
    n = 0
    for para in body["paragraphs"]:
        runs = []
        for r in para:
            if r.get("k") == "t":
                runs.append({"k": "t", "text": r["text"]})
                continue
            item = items[r["item"]]
            key = f"q{n}"
            n += 1
            first_key.setdefault(r["item"], key)
            kind, original, corrected = item["type"], r.get("original", ""), bool(r.get("corrected"))
            ref, note = "", ""
            from_source = kind == "ayah" and bool(item.get("text")) and item.get("status") in ("verified", "different")
            if kind == "ayah":
                if item.get("surah_name"):
                    ref = _ayah_ref(item)
                if item.get("status") == "unverified":
                    note = "لم أقف عليها بهذا اللفظ في المصحف."
                elif item.get("status") == "translated":
                    note = "ذُكرت في المقطع بالمعنى."
                elif corrected:
                    note = f"تلاها المتحدث: «{original}»."
                full = item.get("text") or ""
                if from_source and full and _words_of(r["text"]) != _words_of(full):
                    # Only part of the verse was said: the footnote gives it in full.
                    note = (note + " " if note else "") + f"الآية كاملة: ﴿{_without_numbers(full)}﴾"
            elif kind == "hadith":
                note = _hadith_note(item, original, corrected)
            else:
                who = item.get("person") or ""
                note = (f"القائل: {who}. " if who else "") + "نُقل كما ورد في المقطع."
            runs.append({
                "k": "q", "type": kind, "text": r["text"], "key": key,
                "ref": ref, "note": note, "from_source": from_source,
            })
        if runs:
            paragraphs.append(runs)

    used = [(i, items[i]) for i in first_key]
    ayat = sorted((x for x in used if x[1]["type"] == "ayah" and x[1].get("surah")),
                  key=lambda x: (x[1]["surah"], x[1].get("ayah_from") or 0))
    ahadith = sorted((x for x in used if x[1]["type"] == "hadith"),
                     key=lambda x: sources.normalize(x[1].get("said", "")))
    athar = sorted((x for x in used if x[1]["type"] in ("athar", "qawl")),
                   key=lambda x: (sources.normalize(x[1].get("person") or "ي"), sources.normalize(x[1].get("said", ""))))

    def short_source(item: dict) -> str:
        if item.get("collection"):
            return f"{AUTHORS.get(item['collection'], '')} ({digits(item.get('number', ''))})"
        return "لم أقف عليه"

    index = {
        "ayat": [{"text": "﴿" + _excerpt(it.get("text", "")) + "﴾", "ref": _ayah_ref(it), "key": first_key[i]} for i, it in ayat],
        "ahadith": [{"text": "«" + _excerpt(it.get("said", "")) + "»", "ref": short_source(it), "key": first_key[i]} for i, it in ahadith],
        "athar": [{"text": "«" + _excerpt(it.get("said", "")) + "»", "ref": it.get("person") or "", "key": first_key[i]} for i, it in athar],
    }
    present = {it["type"] for _, it in used}
    legend_labels = {"ayah": "الآيات", "hadith": "الأحاديث", "athar": "آثار الصحابة", "qawl": "أقوال العلماء"}
    duration = float(body.get("duration") or 0)
    facts = [["المصدر", body.get("url", "")], ["مدة المقطع", digits(format_time(duration))], ["تاريخ التفريغ", digits(date.today().strftime("%Y/%m/%d"))]]
    if present:
        counts = "، ".join(f"{legend_labels[t]}: {digits(sum(1 for _, it in used if it['type'] == t))}" for t in legend_labels if t in present)
        facts.append(["الأدلة", counts])
    return {
        "rtl": rtl,
        "title": body.get("title") or "تفريغ",
        "speaker": body.get("speaker") or "",
        "facts": facts,
        "legend": [{"type": t, "label": legend_labels[t]} for t in legend_labels if t in present],
        "paragraphs": paragraphs,
        "index": index,
        "labels": {
            "kind": "تفريغ مقطع",
            "ayat": "فهرس الآيات",
            "ahadith": "فهرس الأحاديث",
            "athar": "فهرس الآثار وأقوال العلماء",
        },
    }


def render(body: dict) -> bytes:
    data = build_data(body)
    return typst.compile(
        str(TEMPLATE),
        font_paths=[str(FONTS)],
        sys_inputs={"data": json.dumps(data, ensure_ascii=False)},
        ignore_system_fonts=True,
    )
