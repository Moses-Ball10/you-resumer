"use client";

import { useSyncExternalStore } from "react";

/**
 * The visitor's own AI keys. They are stored only in this browser (localStorage) and sent
 * with each AI request; the server never saves them.
 */
export type Keys = { gemini: string; groq: string };

const STORAGE = "you-resumer:keys";
const EMPTY: Keys = { gemini: "", groq: "" };
let keys: Keys = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Keys {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE) ?? "null");
      if (saved && typeof saved === "object") keys = { gemini: String(saved.gemini ?? ""), groq: String(saved.groq ?? "") };
    } catch {
      // Storage blocked or unreadable: the visitor can still type keys for this visit.
    }
  }
  return keys;
}

export function getKeys(): Keys {
  return load();
}

export function saveKeys(next: Keys) {
  keys = { gemini: next.gemini.trim(), groq: next.groq.trim() };
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(keys));
  } catch {
    // Kept in memory for this visit only.
  }
  listeners.forEach((l) => l());
}

export function useKeys(): Keys {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load,
    () => EMPTY,
  );
}

/** Headers carrying the visitor's keys to the backend. */
export function keyHeaders(): Record<string, string> {
  const k = load();
  const headers: Record<string, string> = {};
  if (k.gemini) headers["X-Gemini-Key"] = k.gemini;
  if (k.groq) headers["X-Groq-Key"] = k.groq;
  return headers;
}
