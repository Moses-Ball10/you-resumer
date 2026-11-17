"use client";

import { parseTime } from "@/lib/api";

const TIME = String.raw`\d{1,2}(?::\d{2}){1,2}`;
// One citation: "V2 3:15", "3:15", "1:02:30", optionally a range "3:15-3:59" (only the start is used).
const ONE = new RegExp(String.raw`^\s*(?:V(\d+)\s+)?(${TIME})(?:\s*[-–]\s*${TIME})?\s*$`);
// A bracket holding one or more citations separated by commas or semicolons: [V1 3:15], [3:55, 6:32].
const BRACKET = /\[([^\[\]]{1,200})\]/g;

type Citation = { video?: number; time: string };

function parseBracket(inner: string): Citation[] | null {
  const items = inner.split(/[,;]/);
  const out: Citation[] = [];
  for (const item of items) {
    const m = item.match(ONE);
    if (!m) return null; // not a citation, e.g. "[note]": keep it as text
    out.push({ video: m[1] ? Number(m[1]) : undefined, time: m[2] });
  }
  return out;
}

type Props = {
  text: string;
  /** Video index (1-based) used when a citation has no [V..] prefix. */
  defaultVideo?: number;
  onSeek: (videoIndex: number, seconds: number) => void;
};

/** Renders **bold** spans (the only markdown the models commonly use in short answers). */
function withBold(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

/** Renders model output, turning timestamp citations into buttons that jump the player. */
export function RichText({ text, defaultVideo = 1, onSeek }: Props) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(BRACKET)) {
    const citations = parseBracket(match[1]);
    if (!citations) continue;
    const index = match.index ?? 0;
    parts.push(...withBold(text.slice(last, index), `t${last}`));
    citations.forEach((c, i) => {
      const video = c.video ?? defaultVideo;
      const seconds = parseTime(c.time);
      parts.push(
        <button
          key={`${index}-${i}`}
          onClick={() => onSeek(video, seconds)}
          className="mx-0.5 inline-flex items-center rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[0.8em] text-accent hover:bg-accent/25"
          title="Jump to this moment"
        >
          {c.video ? `V${video} ` : ""}
          {c.time}
        </button>,
      );
    });
    last = index + match[0].length;
  }
  parts.push(...withBold(text.slice(last), `t${last}`));
  return <div className="whitespace-pre-wrap leading-relaxed">{parts}</div>;
}
