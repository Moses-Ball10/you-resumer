"use client";

import { useEffect, useRef } from "react";
import { setControls, setPlaying, setPosition } from "@/lib/playback";

// Minimal types for the YouTube IFrame Player API.
type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  cueVideoById(videoId: string): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

type Props = {
  videoId: string;
  title: string;
  /** A request to jump: a new nonce means "go to `at` and play". */
  seek: { at: number; nonce: number };
};

/**
 * The YouTube player, driven through YouTube's player API: jumping to a moment does not reload
 * the video, and the current position is published for the full text to follow.
 */
export function Player({ videoId, title, seek }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const loaded = useRef("");
  const lastNonce = useRef(0);
  const latest = useRef({ videoId, seek });
  latest.current = { videoId, seek };

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    const mount = document.createElement("div");
    host.current?.appendChild(mount);
    loadApi().then((YT) => {
      if (cancelled) return;
      const { videoId: id, seek: s } = latest.current;
      loaded.current = id;
      lastNonce.current = s.nonce;
      player.current = new YT.Player(mount, {
        videoId: id,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, playsinline: 1, start: Math.floor(s.at) },
        events: {
          onReady: () => {
            ready.current = true;
            setControls({ play: () => player.current?.playVideo(), pause: () => player.current?.pauseVideo() });
          },
          // 1 = playing, 3 = buffering (still counts as playing for the button).
          onStateChange: (e) => setPlaying(e.data === 1 || e.data === 3),
        },
      });
    });
    const timer = window.setInterval(() => {
      const p = player.current;
      if (ready.current && p?.getCurrentTime) setPosition(loaded.current, p.getCurrentTime());
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      player.current?.destroy();
      player.current = null;
      setControls(null);
      setPlaying(false);
      mount.remove();
      ready.current = false;
    };
  }, []);

  // Switch video, or jump to a moment.
  useEffect(() => {
    const p = player.current;
    if (!p || !ready.current) return;
    const jump = seek.nonce !== lastNonce.current;
    lastNonce.current = seek.nonce;
    if (loaded.current !== videoId) {
      loaded.current = videoId;
      if (jump) p.loadVideoById({ videoId, startSeconds: seek.at });
      else p.cueVideoById(videoId);
    } else if (jump) {
      p.seekTo(seek.at, true);
      p.playVideo();
    }
  }, [videoId, seek]);

  return <div ref={host} title={title} className="h-full w-full [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full" />;
}
