"""Trusted texts of the Qur'an and hadith, stored locally and searchable.

The Qur'an comes from alquran.cloud (Tanzil text): the Uthmani script with full tashkeel
for display, and the simple clean script for matching. The hadith come from the free
hadith-api (fawazahmed0), Arabic with tashkeel and the scholars' grades.

Everything is downloaded once (about 7 MB) into `sources.db` next to the app, with
full-text search indexes. Build it ahead of time with `uv run python -m app.sources`,
or it is built on first use.
"""

import difflib
import json
import logging
import re
import sqlite3
import threading
from dataclasses import dataclass, field
from pathlib import Path

import httpx

log = logging.getLogger("uvicorn.error")

DB_PATH = Path(__file__).resolve().parent.parent / "sources.db"
QURAN_URL = "https://api.alquran.cloud/v1/quran/{edition}"
HADITH_URL = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-{name}.min.json"

# In the order a source is preferred when the same hadith appears in several collections.
COLLECTIONS = {
    "bukhari": "صحيح البخاري",
    "muslim": "صحيح مسلم",
    "abudawud": "سنن أبي داود",
    "tirmidhi": "جامع الترمذي",
    "nasai": "سنن النسائي",
    "ibnmajah": "سنن ابن ماجه",
    "malik": "موطأ مالك",
    "nawawi": "الأربعون النووية",
    "qudsi": "الأحاديث القدسية",
}
_RANK = {name: i for i, name in enumerate(COLLECTIONS)}

GRADERS = {
    "Al-Albani": "الألباني",
    "Ahmad Muhammad Shakir": "أحمد شاكر",
    "Zubair Ali Zai": "زبير علي زئي",
    "Abu Ghuddah": "أبو غدة",
    "Salim al-Hilali": "سليم الهلالي",
    "Muhammad Muhyi Al-Din Abdul Hamid": "محمد محيي الدين عبد الحميد",
    "Bashar Awad Maarouf": "بشار عواد معروف",
    "Shuaib Al Arnaut": "شعيب الأرناؤوط",
    "Muhammad Fouad Abd al-Baqi": "محمد فؤاد عبد الباقي",
}

# Longest phrases first, so "Very Daif" wins over "Daif".
_GRADE_WORDS = [
    ("Bukhari And Muslim", "البخاري ومسلم"),
    ("Agreed Upon", "متفق عليه"),
    ("Very Daif", "ضعيف جداً"),
    ("Lighairihi", "لغيره"),
    ("Mutawatir", "متواتر"),
    ("Mauquf", "موقوف"),
    ("Muquf", "موقوف"),
    ("Maqtu", "مقطوع"),
    ("Isnaad", "الإسناد"),
    ("Sanad", "الإسناد"),
    ("Mursal", "مرسل"),
    ("Munkar", "منكر"),
    ("Mawdu", "موضوع"),
    ("Hadith", "الحديث"),
    ("Bukhari", "البخاري"),
    ("Muslim", "مسلم"),
    ("Shadh", "شاذ"),
    ("Sahih", "صحيح"),
    ("Hasan", "حسن"),
    ("Batil", "باطل"),
    ("Daif", "ضعيف"),
    ("Matn", "المتن"),
]


def grade_ar(grade: str) -> str:
    out = grade.strip()
    for en, ar in _GRADE_WORDS:
        out = re.sub(rf"\b{en}\b", ar, out)
    return out


# ---------------------------------------------------------------- normalizing and matching

_MARKS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")  # tashkeel, Qur'an marks, tatweel
_NOT_LETTER = re.compile(r"[^ء-ي\s]")
_PREFIXES = ("وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل")


def normalize(text: str) -> str:
    """Arabic without tashkeel and with the letter forms that people spell differently unified."""
    t = _MARKS.sub("", text)
    t = re.sub("[إأآٱ]", "ا", t)
    t = t.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي").replace("ء", "")
    t = _NOT_LETTER.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def words(text: str) -> list[str]:
    return [w for w in normalize(text).split() if len(w) > 1]


def has_arabic(text: str) -> bool:
    return len(words(text)) >= 2


def _stem(w: str) -> str:
    for p in _PREFIXES:
        if w.startswith(p) and len(w) - len(p) >= 2:
            return w[len(p) :]
    return w


def stems(text: str) -> list[str]:
    return [_stem(w) for w in words(text)]


def match_score(query: str, candidate: str) -> float:
    fraction, _ = match_detail(query, candidate)
    return fraction


def matching_blocks(query: str, cand: list[str]) -> list[difflib.Match]:
    """Runs of 2+ query words found in the same order in `cand` (a list of stems)."""
    q = stems(query)
    vocab = set(cand)
    vocab_list = list(vocab)
    mapped = []
    for w in q:
        if w not in vocab and len(w) >= 4:
            close = difflib.get_close_matches(w, vocab_list, n=1, cutoff=0.8)
            w = close[0] if close else w
        mapped.append(w)
    blocks = difflib.SequenceMatcher(None, mapped, cand, autojunk=False).get_matching_blocks()
    return [b for b in blocks if b.size >= 2]


def match_detail(query: str, candidate: str) -> tuple[float, int]:
    """Share of the query's words found in the candidate as phrases of 2+ words in the same order.

    Small spelling mistakes and prefixes (و، ف، ال…) are tolerated. Matching phrases, not loose
    words, keeps a long text full of common words from matching a quote it does not contain.
    """
    q = stems(query)
    if not q:
        return 0.0, 0
    cand = stems(candidate)
    if len(q) == 1:
        return (1.0, 1) if q[0] in set(cand) else (0.0, 0)
    found = sum(b.size for b in matching_blocks(query, cand))
    return found / len(q), found


# ---------------------------------------------------------------- building the database

_lock = threading.Lock()


def is_ready() -> bool:
    if not DB_PATH.exists():
        return False
    try:
        with sqlite3.connect(DB_PATH) as con:
            return con.execute("select value from meta where key = 'ready'").fetchone() is not None
    except sqlite3.Error:
        return False


def _strip_basmala(text: str) -> str:
    # The source puts the basmala (4 words) in front of the first verse of every surah except al-Fatiha.
    parts = text.split(" ")
    if normalize(" ".join(parts[:4])) == "بسم الله الرحمن الرحيم":
        return " ".join(parts[4:]).strip()
    return text


def build() -> None:
    """Downloads the Qur'an and the hadith collections and builds the search indexes."""
    with _lock:
        if is_ready():
            return
        tmp = DB_PATH.with_suffix(".tmp")
        tmp.unlink(missing_ok=True)
        con = sqlite3.connect(tmp)
        con.executescript(
            """
            create table meta(key text primary key, value text);
            create table quran(surah int, ayah int, surah_name text, text text, clean text, primary key(surah, ayah));
            create virtual table quran_fts using fts5(norm, surah unindexed, ayah unindexed);
            create table hadith(id integer primary key, collection text, number text, text text, grades text);
            create virtual table hadith_fts using fts5(norm, content='');
            """
        )
        with httpx.Client(timeout=180, follow_redirects=True) as http:
            log.info("Downloading the Qur'an")
            uthmani = http.get(QURAN_URL.format(edition="quran-uthmani")).json()["data"]["surahs"]
            clean = http.get(QURAN_URL.format(edition="quran-simple-clean")).json()["data"]["surahs"]
            for su, sc in zip(uthmani, clean):
                for au, ac in zip(su["ayahs"], sc["ayahs"]):
                    tu, tc = au["text"], ac["text"]
                    if su["number"] != 1 and au["numberInSurah"] == 1:
                        tu, tc = _strip_basmala(tu), _strip_basmala(tc)
                    con.execute(
                        "insert into quran values(?,?,?,?,?)", (su["number"], au["numberInSurah"], su["name"], tu, tc)
                    )
                    con.execute("insert into quran_fts values(?,?,?)", (normalize(tc), su["number"], au["numberInSurah"]))
            for name in COLLECTIONS:
                log.info("Downloading hadith collection %s", name)
                for h in http.get(HADITH_URL.format(name=name)).json()["hadiths"]:
                    text = (h.get("text") or "").strip()
                    if not text:
                        continue
                    number = str(h.get("arabicnumber") or h["hadithnumber"])
                    if name == "muslim":
                        number = number.split(".")[0]  # "19.01" is the first narration under Muslim 19
                    grades = [
                        {"by": GRADERS.get(g["name"], g["name"]), "grade": grade_ar(g["grade"])}
                        for g in h.get("grades", [])
                        if g.get("grade", "").strip() not in ("", "-")
                    ]
                    cur = con.execute(
                        "insert into hadith(collection, number, text, grades) values(?,?,?,?)",
                        (name, number, text, json.dumps(grades, ensure_ascii=False)),
                    )
                    con.execute("insert into hadith_fts(rowid, norm) values(?,?)", (cur.lastrowid, normalize(text)))
        con.execute("insert into meta values('ready', '1')")
        con.commit()
        con.close()
        tmp.replace(DB_PATH)
        log.info("Qur'an and hadith data ready")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def _fts_query(text: str) -> str:
    terms = {w for w in words(text)} | {_stem(w) for w in words(text)}
    return " OR ".join(f'"{t}"' for t in terms if len(t) > 1)


# ---------------------------------------------------------------- Qur'an


@dataclass
class Ayat:
    surah: int
    surah_name: str
    ayah_from: int
    ayah_to: int
    text: str  # Uthmani with tashkeel; verses separated by their number
    clean: str


def get_ayat(surah: int, ayah_from: int, ayah_to: int | None = None) -> Ayat | None:
    ayah_to = max(ayah_to or ayah_from, ayah_from)
    ayah_to = min(ayah_to, ayah_from + 9)
    with _connect() as con:
        rows = con.execute(
            "select * from quran where surah = ? and ayah between ? and ? order by ayah", (surah, ayah_from, ayah_to)
        ).fetchall()
    if not rows:
        return None
    text = " ".join(f"{r['text']} ﴿{_arabic_digits(r['ayah'])}﴾" for r in rows)
    return Ayat(surah, rows[0]["surah_name"], rows[0]["ayah"], rows[-1]["ayah"], text, " ".join(r["clean"] for r in rows))


def search_quran(text: str) -> tuple[Ayat, float] | None:
    """The single verse that best matches the text, with its match score."""
    query = _fts_query(text)
    if not query:
        return None
    with _connect() as con:
        rows = con.execute(
            "select surah, ayah from quran_fts where quran_fts match ? order by bm25(quran_fts) limit 40", (query,)
        ).fetchall()
    best: tuple[Ayat, float] | None = None
    for r in rows:
        ayat = get_ayat(r["surah"], r["ayah"])
        if ayat:
            score = match_score(text, ayat.clean)
            if not best or score > best[1]:
                best = (ayat, score)
    return best


def _num(number: str) -> float:
    try:
        return float(number)
    except ValueError:
        return float("inf")


def _arabic_digits(n: int) -> str:
    return str(n).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))


# ---------------------------------------------------------------- hadith


@dataclass
class Hadith:
    collection: str
    collection_name: str
    number: str
    text: str
    grades: list[dict]
    score: float
    also_in: list[dict] = field(default_factory=list)


def search_hadith(*texts: str) -> Hadith | None:
    """The hadith that best matches any of the texts, preferring the stronger collections."""
    texts = tuple(t for t in texts if t and has_arabic(t))
    if not texts:
        return None
    ids: dict[int, None] = {}
    with _connect() as con:
        for t in texts:
            for r in con.execute(
                "select rowid from hadith_fts where hadith_fts match ? order by bm25(hadith_fts) limit 100", (_fts_query(t),)
            ):
                ids[r[0]] = None
        if not ids:
            return None
        rows = con.execute(f"select * from hadith where id in ({','.join('?' * len(ids))})", list(ids)).fetchall()
    scored = []
    for r in rows:
        score = max(match_score(t, r["text"]) for t in texts)
        scored.append((score, r))
    top = max(s for s, _ in scored)
    # Same hadith, best source first: strongest collection, then its first narration there.
    best = sorted(
        (x for x in scored if x[0] >= top - 0.1), key=lambda x: (_RANK[x[1]["collection"]], _num(x[1]["number"]))
    )
    score, r = best[0]
    also, seen = [], {r["collection"]}
    for _, o in best[1:]:
        if o["collection"] not in seen:
            seen.add(o["collection"])
            also.append({"collection": o["collection"], "collection_name": COLLECTIONS[o["collection"]], "number": o["number"]})
    return Hadith(
        r["collection"], COLLECTIONS[r["collection"]], r["number"], r["text"], json.loads(r["grades"]), score, also[:5]
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if is_ready():
        print(f"Already built: {DB_PATH}")
    else:
        build()
        print(f"Built {DB_PATH} ({DB_PATH.stat().st_size / 1e6:.0f} MB)")
