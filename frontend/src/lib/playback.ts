"use client";

/**
 * The player's current position, shared without re-rendering the page several times a second.
 * Components read it with `subscribe` and update the DOM themselves.
 */
type Position = { videoId: string; time: number };

let position: Position = { videoId: "", time: 0 };
const listeners = new Set<(p: Position) => void>();

export function setPosition(videoId: string, time: number) {
  if (position.videoId === videoId && Math.abs(position.time - time) < 0.05) return;
  position = { videoId, time };
  listeners.forEach((l) => l(position));
}

export function getPosition(): Position {
  return position;
}

export function subscribe(listener: (p: Position) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Play/pause for controls outside the player (the full-text bar), and whether it is playing. */
type Controls = { play: () => void; pause: () => void };
let controls: Controls | null = null;
let playing = false;
const playingListeners = new Set<(playing: boolean) => void>();

export function setControls(next: Controls | null) {
  controls = next;
}

export function setPlaying(next: boolean) {
  if (next === playing) return;
  playing = next;
  playingListeners.forEach((l) => l(playing));
}

export function isPlaying(): boolean {
  return playing;
}

export function subscribePlaying(listener: (playing: boolean) => void): () => void {
  playingListeners.add(listener);
  return () => playingListeners.delete(listener);
}

export function togglePlay() {
  if (playing) controls?.pause();
  else controls?.play();
}
