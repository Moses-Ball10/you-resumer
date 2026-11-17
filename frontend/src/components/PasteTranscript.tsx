"use client";

import { useState } from "react";
import { ApiError, pasteVideo, type Video } from "@/lib/api";

/**
 * Shown when YouTube refuses to give our server a video's captions. The visitor's own device
 * is not blocked, so they copy the transcript from YouTube and paste it here.
 */
export function PasteTranscript({ url, onLoaded, onCancel }: { url: string; onLoaded: (v: Video) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLoaded(await pasteVideo(url, text));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full space-y-3 rounded-xl border border-line bg-surface p-4 text-left">
      <div>
        <p className="font-medium">YouTube refused our server. Paste the transcript instead:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Open{" "}
            <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              the video on YouTube ↗
            </a>
            .
          </li>
          <li>Under the video, click “…more”, then “Show transcript”.</li>
          <li>Select the whole transcript with its times, copy it, and paste it below.</li>
        </ol>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        dir="auto"
        placeholder={"0:00\nالسلام عليكم ورحمة الله وبركاته\n0:04\nإن الحمد لله…"}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm">
          Cancel
        </button>
        <button disabled={busy || text.trim().length < 10} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Loading…" : "Use this transcript"}
        </button>
      </div>
    </form>
  );
}
