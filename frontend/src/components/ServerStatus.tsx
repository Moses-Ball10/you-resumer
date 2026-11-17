"use client";

import { useEffect, useState } from "react";
import { ping } from "@/lib/api";

/**
 * On free hosting the server sleeps after 15 minutes without visitors and takes about a minute
 * to wake. This banner says so while it wakes, instead of letting the page look broken.
 */
export function ServerStatus() {
  const [state, setState] = useState<"checking" | "waking" | "ready">("checking");

  useEffect(() => {
    let stopped = false;
    const slow = setTimeout(() => !stopped && setState((s) => (s === "checking" ? "waking" : s)), 2500);
    (async () => {
      for (let attempt = 0; attempt < 40 && !stopped; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        const ok = await ping(controller.signal);
        clearTimeout(timer);
        if (ok) {
          if (!stopped) setState("ready");
          return;
        }
        if (!stopped) setState("waking");
        await new Promise((r) => setTimeout(r, 4000));
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(slow);
    };
  }, []);

  if (state !== "waking") return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
      Waking up the server… It sleeps when nobody uses it (free hosting) and takes about a minute to start.
    </div>
  );
}
