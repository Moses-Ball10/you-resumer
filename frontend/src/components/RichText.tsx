"use client";

import { parseTime } from "@/lib/api";

// Matches citations like [V2 3:15], [3:15] or [1:02:30].
const CITATION = /\[(?:V(\d+)\s+)?(\d{1,2}(?::\d{2}){1,2})(?:\s*-\s*\d{1,2}(?::\d{2}){1,2})?\]/g;

type Props = {
  text: string;
  /** Video index (1-based) used when a citation has no [V..] prefix. */
  defaultVideo?: number;
  onSeek: (videoIndex: number, seconds: number) => void;
};

/** Renders model output, turning timestamp citations into buttons that jump the player. */
export function RichText({ text, defaultVideo = 1, onSeek }: Props) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const index = match.index ?? 0;
    parts.push(text.slice(last, index));
    const video = match[1] ? Number(match[1]) : defaultVideo;
    const seconds = parseTime(match[2]);
    parts.push(
      <button
        key={index}
        onClick={() => onSeek(video, seconds)}
        className="mx-0.5 inline-flex items-center rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[0.8em] text-accent hover:bg-accent/25"
        title="Jump to this moment"
      >
        {match[1] ? `V${video} ` : ""}
        {match[2]}
      </button>,
    );
    last = index + match[0].length;
  }
  parts.push(text.slice(last));
  return <div className="whitespace-pre-wrap leading-relaxed">{parts}</div>;
}
