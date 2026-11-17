"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, clearAdillah, getAdillah, type AdillahState, type Video } from "./api";

/**
 * Evidence analysis of each video. It starts by itself when a video is added and runs in the
 * background, separately from the request queue, one video at a time. Results arrive packet by
 * packet. When the AI providers are busy or the visitor has no key yet, it pauses and the
 * visitor can retry.
 */
export type AdillahRun = {
  status: "waiting" | "running" | "paused" | "done" | "stopped";
  data?: AdillahState;
  model?: string;
  stage?: string;
  pause?: { message: string };
};

type Options = { force?: boolean };

export function useAdillah(videos: Video[]) {
  const [runs, setRuns] = useState<Record<string, AdillahRun>>({});
  const pending = useRef<{ id: string; options: Options }[]>([]);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const started = useRef(new Set<string>());

  const update = useCallback((id: string, changes: Partial<AdillahRun>) => {
    setRuns((all) => ({ ...all, [id]: { ...(all[id] ?? { status: "waiting" }), ...changes } }));
  }, []);

  const runOne = useCallback(
    async (id: string, options: Options, signal: AbortSignal) => {
      update(id, { status: "running", pause: undefined, stage: undefined });
      const handlers = {
        onStage: (stage: string) => update(id, { stage }),
        onModel: (model: string) => update(id, { model }),
        onPacket: (data: AdillahState) => update(id, { data }),
      };
      try {
        const data = await getAdillah(id, handlers, signal, options.force);
        update(id, { status: "done", data, stage: undefined });
      } catch (err) {
        if (signal.aborted) {
          update(id, { status: "stopped", stage: undefined });
        } else {
          const message = err instanceof ApiError ? err.message : "The analysis stopped. Please try again.";
          update(id, { status: "paused", stage: undefined, pause: { message } });
        }
      }
    },
    [update],
  );

  const pump = useCallback(async () => {
    if (active.current) return;
    const next = pending.current.shift();
    if (!next) return;
    const controller = new AbortController();
    active.current = { id: next.id, controller };
    await runOne(next.id, next.options, controller.signal);
    active.current = null;
    void pump();
  }, [runOne]);

  const start = useCallback(
    (id: string, options: Options = {}) => {
      if (active.current?.id === id || pending.current.some((p) => p.id === id)) return;
      pending.current.push({ id, options });
      update(id, { status: "waiting", pause: undefined });
      void pump();
    },
    [pump, update],
  );

  const stop = useCallback(
    (id: string) => {
      pending.current = pending.current.filter((p) => p.id !== id);
      if (active.current?.id === id) active.current.controller.abort();
      else update(id, { status: "stopped" });
    },
    [update],
  );

  /** Deletes the saved analysis and analyses the video again. */
  const restart = useCallback(
    async (id: string) => {
      stop(id);
      await clearAdillah(id);
      setRuns((all) => {
        const next = { ...all };
        delete next[id];
        return next;
      });
      start(id);
    },
    [start, stop],
  );

  // Start automatically for every video that is added.
  useEffect(() => {
    for (const v of videos) {
      if (!started.current.has(v.id)) {
        started.current.add(v.id);
        start(v.id);
      }
    }
  }, [videos, start]);

  return { runs, start, stop, restart };
}

export type AdillahController = ReturnType<typeof useAdillah>;
