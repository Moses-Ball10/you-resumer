"use client";

import { useState } from "react";
import { ApiError, getSummary, type SummaryStyle, type Video } from "@/lib/api";
import { RichText } from "./RichText";

const STYLES: { id: SummaryStyle; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "detailed", label: "Detailed" },
  { id: "key_points", label: "Key points" },
  { id: "chapters", label: "Chapters" },
];

type Props = { video: Video; videoIndex: number; onSeek: (videoIndex: number, seconds: number) => void };

export function SummaryPanel({ video, videoIndex, onSeek }: Props) {
  const [style, setStyle] = useState<SummaryStyle>("short");
  const [results, setResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const key = `${video.id}:${style}`;
  const content = results[key];

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const text = await getSummary(video.id, style);
      setResults((r) => ({ ...r, [key]: text }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyle(s.id)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              style === s.id ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {content ? (
          <RichText text={content} defaultVideo={videoIndex} onSeek={onSeek} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted">
            <p>Summary of “{video.title || video.id}”</p>
            <button
              onClick={generate}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60"
            >
              {loading ? "Summarizing…" : "Generate summary"}
            </button>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
