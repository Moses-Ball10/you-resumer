import type { Evidence, Segment } from "./api";

/**
 * The full text of a video, built from its captions without any AI: the caption lines are joined
 * with spaces and split into paragraphs at pauses. Each word gets an estimated time (spread over
 * its caption line by length), and the quotes found by the evidence analysis become colored units.
 */
export type Word = { si: number; wi: number; t: number; text: string };

export type Unit =
  | { kind: "word"; id: number; from: number; to: number }
  | {
      kind: "quote";
      id: number;
      from: number;
      to: number;
      item: Evidence;
      /** The text shown: the correct wording from the source when there is one. */
      text: string;
      /** The words as said in the video. */
      original: string;
      /** The source's wording differs from what was said. */
      corrected: boolean;
      /** The shown words, each with the spoken word it follows (for highlighting and clicking). */
      tokens: { text: string; w: number }[];
    };

export type Doc = {
  words: Word[];
  paragraphs: Unit[][];
  /** For each spoken word, the key (data-h) of the element to highlight while it is said. */
  markOfWord: string[];
};

const PAUSE_SECONDS = 1;
const SENTENCE_END = /[.!?؟…]["»”]?$/;

/**
 * The speaker's normal speed in characters per second. Each caption line gives characters ÷ time
 * until the next line; lines followed by a silence look slow, so a fast value (the 75th
 * percentile) is taken: it reflects the lines spoken without pauses.
 */
export function speakingRate(segments: Segment[]): number {
  const rates: number[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    const gap = segments[i + 1].start - segments[i].start;
    if (gap > 0.3 && segments[i].text.length) rates.push(segments[i].text.length / gap);
  }
  if (!rates.length) return Infinity;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length * 0.75)];
}

export function buildWords(segments: Segment[]): Word[] {
  const words: Word[] = [];
  const rate = speakingRate(segments);
  segments.forEach((seg, si) => {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    const next = si + 1 < segments.length ? Math.max(segments[si + 1].start, seg.start) : seg.start + seg.duration;
    // Spread the words over the time it takes to say them, not over a silence after the sentence:
    // the last word then stays highlighted during the pause.
    const end = Math.min(next, seg.start + seg.text.length / rate);
    const total = tokens.reduce((n, t) => n + t.length + 1, 0) || 1;
    let offset = 0;
    tokens.forEach((text, wi) => {
      words.push({ si, wi, t: seg.start + ((end - seg.start) * offset) / total, text });
      offset += text.length + 1;
    });
  });
  return words;
}

/** Quote ranges as word indexes, earliest first, without overlaps. */
function quoteRanges(words: Word[], items: Evidence[]) {
  const index = new Map<string, number>();
  words.forEach((w, i) => index.set(`${w.si}:${w.wi}`, i));
  const ranges: { from: number; to: number; item: Evidence; correct: string }[] = [];
  for (const item of items) {
    (item.spans ?? []).forEach(([first, last], k) => {
      const from = index.get(`${first[0]}:${first[1]}`);
      const to = index.get(`${last[0]}:${last[1]}`);
      // Older analyses have one correct wording for the whole item; use it only when it has a single place.
      const correct = item.span_texts ? (item.span_texts[k] ?? "") : item.spans!.length === 1 ? (item.correct_text ?? "") : "";
      if (from !== undefined && to !== undefined && to >= from) ranges.push({ from, to, item, correct });
    });
  }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const out: typeof ranges = [];
  for (const r of ranges) if (!out.length || r.from > out[out.length - 1].to) out.push(r);
  return out;
}

export function buildDoc(segments: Segment[], items: Evidence[]): Doc {
  const words = buildWords(segments);
  const ranges = quoteRanges(words, items);
  const markOfWord: string[] = new Array(words.length);
  const paragraphs: Unit[][] = [[]];
  let paraWords = 0;
  let id = 0;
  let r = 0;

  for (let i = 0; i < words.length; ) {
    let unit: Unit;
    if (r < ranges.length && ranges[r].from === i) {
      const { from, to, item, correct: wording } = ranges[r++];
      const original = words.slice(from, to + 1).map((w) => w.text).join(" ");
      const correct = wording && (item.type === "ayah" || item.type === "hadith") ? wording : "";
      unit = {
        kind: "quote",
        id,
        from,
        to,
        item,
        text: correct || original,
        original,
        corrected: Boolean(correct) && item.status === "different",
        tokens: [],
      };
      // Shown words follow the spoken ones in order; when the source's wording has a different
      // number of words, they are spread evenly over the spoken words.
      const shown = unit.text.split(/\s+/).filter(Boolean);
      const n = to - from + 1;
      unit.tokens = shown.map((text, k) => ({ text, w: from + Math.floor((k * n) / shown.length) }));
      for (let j = from; j <= to; j++) {
        markOfWord[j] = `${id}.${Math.min(shown.length - 1, Math.floor(((j - from) * shown.length) / n))}`;
      }
    } else {
      unit = { kind: "word", id, from: i, to: i };
    }
    if (unit.kind === "word") markOfWord[unit.from] = `${id}`;
    paragraphs[paragraphs.length - 1].push(unit);
    paraWords += unit.to - unit.from + 1;
    id++;
    i = unit.to + 1;

    // A new paragraph at a pause or after a long sentence, only between caption lines.
    const last = words[unit.to];
    const next = words[i];
    if (next && next.si !== last.si) {
      const seg = segments[last.si];
      const gap = segments[next.si].start - (seg.start + seg.duration);
      const sentenceEnd = SENTENCE_END.test(seg.text.trim());
      if ((gap >= PAUSE_SECONDS && paraWords >= 12) || (sentenceEnd && paraWords >= 60) || paraWords >= 140) {
        paragraphs.push([]);
        paraWords = 0;
      }
    }
  }
  return { words, paragraphs: paragraphs.filter((p) => p.length), markOfWord };
}

/** Index of the word being spoken at `time` (the last word that started before it). */
export function wordAt(words: Word[], time: number): number {
  let lo = 0;
  let hi = words.length - 1;
  if (hi < 0 || time < words[0].t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (words[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The text of a quote as written in exports: verses in ﴿ ﴾, other quotes in « ». */
export function quoteText(unit: Extract<Unit, { kind: "quote" }>): string {
  return unit.item.type === "ayah" ? `﴿ ${unit.text} ﴾` : `«${unit.text}»`;
}

export function paragraphText(doc: Doc, para: Unit[]): string {
  return para.map((u) => (u.kind === "word" ? doc.words[u.from].text : quoteText(u))).join(" ");
}

export function plainText(doc: Doc): string {
  return doc.paragraphs.map((p) => paragraphText(doc, p)).join("\n\n");
}
