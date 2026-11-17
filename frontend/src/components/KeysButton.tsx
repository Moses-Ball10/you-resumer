"use client";

import { useEffect, useRef, useState } from "react";
import { saveKeys, useKeys } from "@/lib/keys";

/**
 * "🔑 Your keys": each visitor adds their own free AI keys. They are stored only in this browser
 * and sent with the visitor's requests; the server never saves them.
 */
export function KeysButton({ openOnStart = false }: { openOnStart?: boolean }) {
  const keys = useKeys();
  const [open, setOpen] = useState(false);
  const ready = Boolean(keys.gemini || keys.groq);

  // On a first visit (no key yet), open the form once so the visitor sees what to do.
  const asked = useRef(false);
  useEffect(() => {
    if (openOnStart && !ready && !asked.current) {
      asked.current = true;
      setOpen(true);
    }
  }, [openOnStart, ready]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
          ready ? "border-line text-muted hover:text-fg" : "border-danger/50 bg-danger/10 text-danger"
        }`}
        title="Your own AI keys, stored only in this browser"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-danger"}`} />
        🔑 {ready ? `Your keys: ${[keys.gemini && "Gemini", keys.groq && "Groq"].filter(Boolean).join(", ")}` : "Add your free AI key"}
      </button>
      {open && <KeysDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function KeysDialog({ onClose }: { onClose: () => void }) {
  const keys = useKeys();
  const [gemini, setGemini] = useState(keys.gemini);
  const [groq, setGroq] = useState(keys.groq);
  const [show, setShow] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    saveKeys({ gemini, groq });
    onClose();
  }

  const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-title"
        className="w-full max-w-lg space-y-4 rounded-2xl border border-line bg-surface p-6 text-left shadow-2xl"
      >
        <div>
          <h2 id="keys-title" className="text-lg font-semibold">
            Your AI keys
          </h2>
          <p className="mt-1 text-sm text-muted">
            Summaries, questions and the evidence analysis use your own free key. It is stored only in this browser
            and sent with your requests; our server never saves it.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between text-sm font-medium">
            Google Gemini key <span className="text-xs font-normal text-muted">required · free</span>
          </span>
          <input
            ref={first}
            type={show ? "text" : "password"}
            value={gemini}
            onChange={(e) => setGemini(e.target.value)}
            placeholder="AIza…"
            autoComplete="off"
            spellCheck={false}
            className={field}
          />
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            Get a free Gemini key ↗
          </a>
        </label>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between text-sm font-medium">
            Groq key <span className="text-xs font-normal text-muted">optional backup · free</span>
          </span>
          <input
            type={show ? "text" : "password"}
            value={groq}
            onChange={(e) => setGroq(e.target.value)}
            placeholder="gsk_…"
            autoComplete="off"
            spellCheck={false}
            className={field}
          />
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            Get a free Groq key ↗
          </a>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-[var(--accent)]" />
          Show keys
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {(keys.gemini || keys.groq) && (
            <button
              type="button"
              onClick={() => {
                saveKeys({ gemini: "", groq: "" });
                onClose();
              }}
              className="mr-auto rounded-lg px-3 py-2 text-sm text-muted hover:text-danger"
            >
              Remove my keys
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">
            Cancel
          </button>
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Save</button>
        </div>
      </form>
    </div>
  );
}
