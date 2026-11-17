"use client";

import { useState } from "react";
import { clearSummary, getSummary, type SummaryLanguage, type SummaryStyle, type Video } from "@/lib/api";
import type { TaskQueue } from "@/lib/queue";
import { RichText } from "./RichText";
import { TaskStatusLine } from "./Working";

const STYLES: { id: SummaryStyle; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "detailed", label: "Detailed" },
  { id: "key_points", label: "Key points" },
  { id: "chapters", label: "Chapters" },
];

const LANGUAGES: { id: SummaryLanguage; label: string }[] = [
  { id: "auto", label: "Video's language" },
  { id: "en", label: "English" },
  { id: "ar", label: "العربية" },
  { id: "fr", label: "Français" },
];

export type SummaryEntry = { taskId: string; text: string; model?: string };
export type SummaryStore = Record<string, SummaryEntry>;

type Props = {
  video: Video;
  videoIndex: number;
  onSeek: (videoIndex: number, seconds: number) => void;
  queue: TaskQueue;
  summaries: SummaryStore;
  setSummaries: React.Dispatch<React.SetStateAction<SummaryStore>>;
};

export function SummaryPanel({ video, videoIndex, onSeek, queue, summaries, setSummaries }: Props) {
  const [style, setStyle] = useState<SummaryStyle>("short");
  const [language, setLanguage] = useState<SummaryLanguage>("auto");

  const key = `${video.id}:${style}:${language}`;
  const entry = summaries[key];
  const task = queue.get(entry?.taskId);
  const status = task?.status ?? (entry?.text ? "done" : undefined);
  const busy = status === "running" || status === "waiting";
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");

  /** Removes this summary from the screen and from the server's saved copies. */
  async function clear() {
    setClearing(true);
    setClearError("");
    try {
      await clearSummary(video.id, style, language);
      setSummaries((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
    } catch {
      setClearError("Could not clear the saved summary. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  function generate() {
    const styleLabel = STYLES.find((s) => s.id === style)!.label;
    const langLabel = LANGUAGES.find((l) => l.id === language)!.label;
    const label = `Summary · ${styleLabel} · ${langLabel} — ${video.title || video.id}`;
    const taskId = queue.enqueue("summary", label, async (signal, setStage) => {
      let model: string | undefined;
      const set = (text: string) => setSummaries((s) => ({ ...s, [key]: { taskId, text, model } }));
      let text = "";
      const final = await getSummary(
        video.id,
        style,
        language,
        {
          onStage: setStage,
          onModel: (m) => {
            model = m;
            set(text);
          },
          onToken: (t) => {
            text += t;
            set(text);
          },
        },
        signal,
      );
      set(final);
    });
    setSummaries((s) => ({ ...s, [key]: { taskId, text: "" } }));
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
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
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <span className="sr-only sm:not-sr-only">Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as SummaryLanguage)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-fg outline-none focus:border-accent"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {task && busy && (
          <TaskStatusLine task={task} position={queue.position(task.id)} onCancel={() => queue.cancel(task.id)} />
        )}

        {entry?.text ? (
          <div dir={language === "ar" ? "rtl" : "auto"}>
            <RichText text={entry.text} defaultVideo={videoIndex} onSeek={onSeek} />
          </div>
        ) : (
          !busy && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted">
              <p>Summary of “{video.title || video.id}”</p>
              <button onClick={generate} className="rounded-lg bg-accent px-4 py-2 font-medium text-white">
                {status === "failed" || status === "cancelled" ? "Try again" : "Generate summary"}
              </button>
              {status === "failed" && task?.error && <p className="text-sm text-danger">{task.error}</p>}
              {status === "cancelled" && <p className="text-sm">The request was cancelled.</p>}
            </div>
          )
        )}

        {entry?.text && !busy && (
          <div className="mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
            {entry.model && (
              <span className="mr-auto text-xs text-muted" title="The AI provider and model that wrote this summary">
                Generated by {entry.model}
              </span>
            )}
            {clearError && <span className="text-sm text-danger">{clearError}</span>}
            <button
              onClick={clear}
              disabled={clearing}
              title="Delete this summary and its saved copy, so the next one is generated fresh"
              className="rounded-md border border-line px-3 py-1 text-sm text-muted hover:border-danger hover:text-danger disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear"}
            </button>
          </div>
        )}

        {entry?.text && status === "cancelled" && (
          <p className="text-sm text-muted">
            Cancelled before the end.{" "}
            <button onClick={generate} className="text-accent underline">
              Generate again
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
