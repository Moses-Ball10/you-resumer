"use client";

import { useEffect, useRef, useState } from "react";
import type { Task, TaskQueue } from "@/lib/queue";

const BADGE: Record<Task["status"], { text: string; className: string }> = {
  running: { text: "Processing", className: "bg-accent text-white" },
  waiting: { text: "Waiting", className: "bg-line text-fg" },
  done: { text: "Done", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  cancelled: { text: "Cancelled", className: "bg-line text-muted" },
  failed: { text: "Failed", className: "bg-danger/15 text-danger" },
};

/**
 * All requests: which one is processing, which are waiting, and how the rest ended.
 * A one-line bar; the list opens over the page, so a long queue never pushes the panels away.
 */
export function QueuePanel({ queue }: { queue: TaskQueue }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { tasks } = queue;

  // Close the list when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (tasks.length === 0) return null;

  const active = tasks.filter((t) => t.status === "running" || t.status === "waiting").length;
  const hasFinished = tasks.length > active;

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {active > 0 && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />}
          <span className="font-medium">Requests</span>
          <span className="truncate text-muted">
            {active > 0 ? `· ${active} in progress` : `· ${tasks.length} finished`}
          </span>
        </span>
        <span className="text-muted">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <ol className="max-h-[45dvh] space-y-1 overflow-y-auto p-2">
            {tasks.map((t) => {
              const badge = BADGE[t.status];
              const position = queue.position(t.id);
              return (
                <li key={t.id} className="rounded-lg px-2 py-2 hover:bg-bg">
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
                      {t.status === "waiting" ? `${badge.text} #${position}` : badge.text}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm" title={t.label}>
                      {t.label}
                    </span>
                    {(t.status === "running" || t.status === "waiting") && (
                      <button
                        onClick={() => queue.cancel(t.id)}
                        className="shrink-0 rounded px-1.5 text-xs text-muted hover:text-danger"
                        title={t.status === "running" ? "Stop this request" : "Remove from queue"}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {t.status === "running" && t.stage && (
                    <p className="mt-1 animate-pulse pl-1 text-xs text-muted">{t.stage}…</p>
                  )}
                  {t.status === "failed" && t.error && <p className="mt-1 pl-1 text-xs text-danger">{t.error}</p>}
                </li>
              );
            })}
          </ol>
          {hasFinished && (
            <button
              onClick={queue.clearFinished}
              className="w-full border-t border-line px-4 py-2 text-xs text-muted hover:text-fg"
            >
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}
