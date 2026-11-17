"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export type TaskStatus = "waiting" | "running" | "done" | "cancelled" | "failed";
export type TaskKind = "summary" | "chat" | "adillah";

export type Task = {
  id: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  stage?: string;
  error?: string;
};

/** The work of a task. Must stop when `signal` is aborted (pass it to fetch). */
export type Job = (signal: AbortSignal, setStage: (stage: string) => void) => Promise<void>;

/**
 * Runs model requests one at a time, in the order they were added.
 * The model can only do one thing well at a time, so nothing skips ahead.
 */
export function useTaskQueue() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const running = useRef<{ id: string; controller: AbortController } | null>(null);

  const patch = useCallback((id: string, changes: Partial<Task>) => {
    setTasks((all) => all.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  const enqueue = useCallback((kind: TaskKind, label: string, job: Job): string => {
    const id = crypto.randomUUID();
    jobs.current.set(id, job);
    setTasks((all) => [...all, { id, kind, label, status: "waiting" }]);
    return id;
  }, []);

  /** Stops the running task (the server then stops the model) or removes a waiting one. */
  const cancel = useCallback(
    (id: string) => {
      if (running.current?.id === id) {
        running.current.controller.abort();
      } else {
        jobs.current.delete(id);
        patch(id, { status: "cancelled", stage: undefined });
      }
    },
    [patch],
  );

  const clearFinished = useCallback(() => {
    setTasks((all) => all.filter((t) => t.status === "waiting" || t.status === "running"));
  }, []);

  // Whenever nothing is running, start the oldest waiting task.
  useEffect(() => {
    if (running.current) return;
    const next = tasks.find((t) => t.status === "waiting");
    if (!next) return;
    const job = jobs.current.get(next.id);
    if (!job) return;

    const controller = new AbortController();
    running.current = { id: next.id, controller };
    patch(next.id, { status: "running", stage: "Starting" });

    job(controller.signal, (stage) => patch(next.id, { stage }))
      .then(() => patch(next.id, { status: "done", stage: undefined }))
      .catch((err) => {
        if (controller.signal.aborted) {
          patch(next.id, { status: "cancelled", stage: undefined });
        } else {
          const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
          patch(next.id, { status: "failed", stage: undefined, error: message });
        }
      })
      .finally(() => {
        jobs.current.delete(next.id);
        running.current = null;
        // Trigger the effect again so the next waiting task starts.
        setTasks((all) => [...all]);
      });
  }, [tasks, patch]);

  /** 1 for the next task to run, 2 after that, and so on. 0 if not waiting. */
  const position = useCallback(
    (id: string) => {
      const waiting = tasks.filter((t) => t.status === "waiting");
      return waiting.findIndex((t) => t.id === id) + 1;
    },
    [tasks],
  );

  const get = useCallback((id: string | undefined) => tasks.find((t) => t.id === id), [tasks]);

  return { tasks, enqueue, cancel, clearFinished, position, get };
}

export type TaskQueue = ReturnType<typeof useTaskQueue>;
