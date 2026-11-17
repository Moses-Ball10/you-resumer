"use client";

import type { Task } from "@/lib/queue";

/** Animated "the request is on its way" indicator, with the current stage. */
export function Working({ stage }: { stage?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" role="status" aria-live="polite">
      <span className="flex items-end gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span>{stage ? `${stage}…` : "Working…"}</span>
    </div>
  );
}

/** Status line for a task that is waiting or running, with its cancel button. */
export function TaskStatusLine({
  task,
  position,
  onCancel,
}: {
  task: Task;
  position: number;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {task.status === "running" ? (
        <Working stage={task.stage} />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="h-2 w-2 rounded-full bg-muted/60" aria-hidden />
          {position === 1 ? "Waiting — next in line" : `Waiting in queue — position ${position}`}
        </div>
      )}
      <button
        onClick={onCancel}
        className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
      >
        Cancel
      </button>
    </div>
  );
}
