"use client";

import { useState } from "react";
import { ApiError, loadVideo, type Video } from "@/lib/api";
import { formatTime } from "@/lib/api";
import { ChatPanel } from "@/components/ChatPanel";
import { SummaryPanel } from "@/components/SummaryPanel";

const MAX_VIDEOS = 5;

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [active, setActive] = useState(0);
  const [seek, setSeek] = useState({ at: 0, nonce: 0 });
  const [tab, setTab] = useState<"summary" | "chat">("summary");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const video = await loadVideo(url);
      const existing = videos.findIndex((v) => v.id === video.id);
      if (existing >= 0) {
        setActive(existing);
      } else if (videos.length >= MAX_VIDEOS) {
        setError(`You can add up to ${MAX_VIDEOS} videos.`);
        return;
      } else {
        setVideos([...videos, video]);
        setActive(videos.length);
        setSeek({ at: 0, nonce: 0 });
      }
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function remove(index: number) {
    setVideos(videos.filter((_, i) => i !== index));
    setActive(0);
  }

  function onSeek(videoIndex: number, seconds: number) {
    const i = Math.min(Math.max(videoIndex - 1, 0), videos.length - 1);
    setActive(i);
    setSeek((s) => ({ at: seconds, nonce: s.nonce + 1 }));
  }

  const current = videos[active];

  const form = (
    <form onSubmit={add} className="flex w-full gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a YouTube link…"
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 outline-none focus:border-accent"
      />
      <button disabled={loading} className="rounded-lg bg-accent px-4 py-2.5 font-medium text-white disabled:opacity-60">
        {loading ? "Loading…" : videos.length ? "Add video" : "Start"}
      </button>
    </form>
  );

  if (!current) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Understand any video <span className="text-accent">in seconds</span>
        </h1>
        <p className="text-lg text-muted">
          Get summaries, ask questions, and compare videos. Answers come only from what the video says, with timestamps.
        </p>
        {form}
        {error && <p className="text-sm text-danger">{error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-7xl gap-6 px-4 py-6 lg:h-dvh lg:grid-cols-[1.2fr_1fr]">
      <section className="flex min-h-0 flex-col gap-4">
        {form}
        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {videos.map((v, i) => (
            <div
              key={v.id}
              className={`flex max-w-full items-center gap-1 rounded-lg border text-sm ${
                i === active ? "border-accent bg-accent/10" : "border-line"
              }`}
            >
              <button onClick={() => setActive(i)} className="truncate py-1.5 pl-3 text-left">
                <span className="font-mono text-accent">V{i + 1}</span> {v.title || v.id}
              </button>
              <button onClick={() => remove(i)} className="px-2 py-1.5 text-muted hover:text-danger" title="Remove">
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            key={`${current.id}-${seek.nonce}`}
            src={`https://www.youtube-nocookie.com/embed/${current.id}?start=${Math.floor(seek.at)}${
              seek.nonce ? "&autoplay=1" : ""
            }`}
            title={current.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>

        <details className="min-h-0 rounded-xl border border-line bg-surface lg:flex-1 lg:overflow-y-auto">
          <summary className="cursor-pointer px-4 py-3 font-medium">Transcript</summary>
          <div className="space-y-1 px-4 pb-4 text-sm">
            {current.segments.map((s, i) => (
              <button key={i} onClick={() => onSeek(active + 1, s.start)} className="block text-left hover:text-accent">
                <span className="mr-2 font-mono text-muted">{formatTime(s.start)}</span>
                {s.text}
              </button>
            ))}
          </div>
        </details>
      </section>

      <section className="flex min-h-[70dvh] flex-col gap-4 lg:min-h-0">
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {(["summary", "chat"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === t ? "bg-accent text-white" : "text-muted"}`}
            >
              {t === "summary" ? "Summary" : videos.length > 1 ? `Ask (${videos.length} videos)` : "Ask"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === "summary" ? (
            <SummaryPanel key={current.id} video={current} videoIndex={active + 1} onSeek={onSeek} />
          ) : (
            <ChatPanel key={videos.map((v) => v.id).join()} videos={videos} onSeek={onSeek} />
          )}
        </div>
      </section>
    </main>
  );
}
