"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, loadVideo, uploadVideo, type Video } from "@/lib/api";
import { useAdillah } from "@/lib/adillah";
import { useKeys } from "@/lib/keys";
import { DeviceCaptionError, fetchCaptionsOnDevice, isNativeApp } from "@/lib/native";
import { useTaskQueue } from "@/lib/queue";
import { AdillahPanel } from "@/components/AdillahPanel";
import { ChatPanel, type ChatStore } from "@/components/ChatPanel";
import { KeysButton } from "@/components/KeysButton";
import { PasteTranscript } from "@/components/PasteTranscript";
import { Player } from "@/components/Player";
import { QueuePanel } from "@/components/QueuePanel";
import { ServerStatus } from "@/components/ServerStatus";
import { SummaryPanel, type SummaryStore } from "@/components/SummaryPanel";
import { Tafrigh } from "@/components/Tafrigh";

const MAX_VIDEOS = 5;

/** The 11-character video id in a YouTube link (same patterns as the backend). */
function extractVideoId(link: string): string | null {
  const m = link.match(/(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(link.trim()) ? link.trim() : null;
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [active, setActive] = useState(0);
  const [seek, setSeek] = useState({ at: 0, nonce: 0 });
  const [tab, setTab] = useState<"tafrigh" | "summary" | "chat" | "adillah">("summary");
  const [showForm, setShowForm] = useState(false); // phones: the link box opens from "+ video"

  // Phones show التفريغ as a tab, selected first; on wider screens it sits under everything.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) setTab("tafrigh");
  }, []);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const queue = useTaskQueue();
  const [summaries, setSummaries] = useState<SummaryStore>({});
  const [chats, setChats] = useState<ChatStore>({});
  const adillah = useAdillah(videos);

  const [pasteFor, setPasteFor] = useState("");
  const keys = useKeys();

  // Analyses that paused (for example, before the visitor added a key) restart once a key is added.
  const { runs, start } = adillah;
  useEffect(() => {
    if (!keys.gemini && !keys.groq) return;
    for (const [id, run] of Object.entries(runs)) if (run.status === "paused") start(id);
    // Only when the keys change, not on every analysis update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.gemini, keys.groq]);

  function addVideo(video: Video) {
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
    setPasteFor("");
    setShowForm(false);
  }

  /**
   * In the installed app: a saved copy if the server has one, otherwise the captions are fetched
   * on this device (YouTube does not block phones) and sent to the server.
   */
  async function loadInApp(link: string): Promise<Video> {
    try {
      return await loadVideo(link, true);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "not_cached") throw err;
    }
    const id = extractVideoId(link);
    if (!id) throw new ApiError("invalid_url", "This does not look like a YouTube link.");
    try {
      const { language, segments } = await fetchCaptionsOnDevice(id);
      return await uploadVideo(link, language, segments);
    } catch (err) {
      if (err instanceof DeviceCaptionError) {
        // "blocked" and "failed" fall through to the paste box; the others are final.
        throw new ApiError(err.code === "failed" ? "fetch_failed" : err.code, err.message);
      }
      throw err;
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError("");
    setPasteFor("");
    try {
      addVideo(isNativeApp() ? await loadInApp(url) : await loadVideo(url));
    } catch (err) {
      if (err instanceof ApiError && (err.code === "blocked" || err.code === "fetch_failed")) {
        setPasteFor(url.trim()); // YouTube refused our server: the visitor pastes the transcript
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  function remove(index: number) {
    setVideos(videos.filter((_, i) => i !== index));
    setActive(0);
  }

  const videoCount = videos.length;
  const onSeek = useCallback(
    (videoIndex: number, seconds: number) => {
      const i = Math.min(Math.max(videoIndex - 1, 0), videoCount - 1);
      setActive(i);
      setSeek((s) => ({ at: seconds, nonce: s.nonce + 1 }));
    },
    [videoCount],
  );

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
        <KeysButton openOnStart />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Understand any video <span className="text-accent">in seconds</span>
        </h1>
        <p className="text-lg text-muted">
          Get summaries, ask questions, and compare videos. Answers come only from what the video says, with timestamps.
        </p>
        {form}
        {error && <p className="text-sm text-danger">{error}</p>}
        {pasteFor && <PasteTranscript url={pasteFor} onLoaded={addVideo} onCancel={() => setPasteFor("")} />}
        <ServerStatus />
        <p className="text-xs text-muted">
          Qur&apos;an text: Tanzil (tanzil.net). Hadith: hadith-api by fawazahmed0. Fonts: Amiri.
        </p>
      </main>
    );
  }

  const run = adillah.runs[current.id];

  // On phones (below 1024 px) the page is one screen: a small video, the tabs, and the chosen panel,
  // with التفريغ as one of the tabs. On wider screens: video and panels side by side, التفريغ below.
  const panelClass = (t: typeof tab) =>
    `min-h-0 flex-1 ${tab === t ? "flex flex-col" : t === "summary" && tab === "tafrigh" ? "hidden lg:flex lg:flex-col" : "hidden"}`;

  return (
    <main
      className="mx-auto grid h-dvh max-w-7xl gap-2 overflow-y-auto p-2 [grid-template-areas:'a'_'t'_'p'] [grid-template-rows:auto_auto_minmax(0,1fr)]
        lg:h-[calc(min(62vh,640px)+75dvh+3rem)] lg:gap-4 lg:overflow-visible lg:p-4 lg:[grid-template-areas:'a_t'_'a_p'_'f_f']
        lg:[grid-template-columns:minmax(0,1fr)_minmax(0,1fr)] lg:[grid-template-rows:auto_minmax(0,1fr)_75dvh]"
    >
      <section className="flex min-h-0 min-w-0 flex-col gap-2 [grid-area:a] lg:gap-3">
        <div className={`${showForm ? "" : "hidden"} lg:block`}>{form}</div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {pasteFor && <PasteTranscript url={pasteFor} onLoaded={addVideo} onCancel={() => setPasteFor("")} />}
        <ServerStatus />

        <div className="flex items-center gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
          <button
            onClick={() => setShowForm(!showForm)}
            className="shrink-0 rounded-full border border-accent px-3 py-1 text-xs font-medium text-accent lg:hidden"
          >
            {showForm ? "× Close" : "+ Video"}
          </button>
          <span className="shrink-0">
            <KeysButton />
          </span>
          {videos.map((v, i) => (
            <div
              key={v.id}
              className={`flex max-w-[70vw] shrink-0 items-center gap-1 rounded-lg border text-sm lg:max-w-full lg:shrink ${
                i === active ? "border-accent bg-accent/10" : "border-line"
              }`}
            >
              <button onClick={() => setActive(i)} className="truncate py-1 pl-3 text-left">
                <span className="font-mono text-accent">V{i + 1}</span> {v.title || v.id}
              </button>
              <button onClick={() => remove(i)} className="px-2 py-1 text-muted hover:text-danger" title="Remove">
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Phones: at most 30% of the screen height. */}
        <div className="flex min-h-0 justify-center lg:flex-1 lg:items-start">
          <div className="aspect-video w-[min(100%,calc(30dvh*16/9))] overflow-hidden rounded-xl bg-black lg:h-full lg:max-h-full lg:w-auto">
            <Player videoId={current.id} title={current.title} seek={seek} />
          </div>
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-2 [grid-area:t] lg:gap-3">
        <QueuePanel queue={queue} />
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {(["tafrigh", "summary", "chat", "adillah"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium ${t === "tafrigh" ? "font-arabic lg:hidden" : ""} ${
                tab === t
                  ? "bg-accent text-white"
                  : t === "summary" && tab === "tafrigh"
                    ? "text-muted lg:bg-accent lg:text-white" // wide screens have no التفريغ tab: Summary shows
                    : "text-muted"
              }`}
            >
              {t === "tafrigh"
                ? "التفريغ"
                : t === "summary"
                  ? "Summary"
                  : t === "adillah"
                    ? "الأدلة"
                    : videos.length > 1
                      ? `Ask (${videos.length})`
                      : "Ask"}
            </button>
          ))}
        </div>
      </section>

      {/* All panels stay mounted and are only hidden, so switching tabs keeps their state. */}
      <section className={`min-h-0 min-w-0 flex-col [grid-area:p] ${tab === "tafrigh" ? "hidden lg:flex" : "flex"}`}>
        <div className={panelClass("summary")}>
          <SummaryPanel
            video={current}
            videoIndex={active + 1}
            onSeek={onSeek}
            queue={queue}
            summaries={summaries}
            setSummaries={setSummaries}
          />
        </div>
        <div className={panelClass("chat")}>
          <ChatPanel videos={videos} onSeek={onSeek} queue={queue} chats={chats} setChats={setChats} />
        </div>
        <div className={panelClass("adillah")}>
          <AdillahPanel
            video={current}
            videoIndex={active + 1}
            onSeek={onSeek}
            run={run}
            onRestart={() => adillah.restart(current.id)}
          />
        </div>
      </section>

      {/* التفريغ: a tab on phones, the full-width bottom row on wider screens. */}
      <section className={`min-h-0 min-w-0 [grid-area:p] lg:[grid-area:f] ${tab === "tafrigh" ? "" : "hidden lg:block"}`}>
        <Tafrigh
          video={current}
          videoIndex={active + 1}
          onSeek={onSeek}
          run={run}
          onStart={(options) => adillah.start(current.id, options)}
          onStop={() => adillah.stop(current.id)}
        />
      </section>
    </main>
  );
}
