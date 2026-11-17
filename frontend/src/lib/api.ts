import { keyHeaders } from "./keys";

export type Segment = { start: number; duration: number; text: string };

export type Video = {
  id: string;
  title: string;
  language: string;
  source: string;
  duration: number;
  segments: Segment[];
};

export type SummaryStyle = "short" | "detailed" | "key_points" | "chapters";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/**
 * Address of the backend. Empty in development (Next.js forwards /api to it); on the hosted site
 * it is the backend's own address, e.g. https://you-resumer-api.onrender.com.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

function api(path: string): string {
  return `${API_URL}${path}`;
}

async function readError(r: Response): Promise<ApiError> {
  try {
    const body = await r.json();
    const d = body.detail;
    if (d?.code) return new ApiError(d.code, d.message);
    return new ApiError("error", typeof d === "string" ? d : "Something went wrong.");
  } catch {
    // Not JSON: the proxy or server failed before the backend could answer.
    if (r.status >= 500)
      return new ApiError("server_down", "The server is not responding. It may be waking up (about a minute); please try again.");
    return new ApiError("error", `Unexpected server response (${r.status}). Please try again.`);
  }
}

export async function loadVideo(url: string): Promise<Video> {
  const r = await fetch(api("/api/videos"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) throw await readError(r);
  return r.json();
}

/** A video whose transcript the visitor pasted (when YouTube refuses our server). */
export async function pasteVideo(url: string, transcript: string): Promise<Video> {
  const r = await fetch(api("/api/videos/paste"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, transcript }),
  });
  if (!r.ok) throw await readError(r);
  return r.json();
}

/** True when the backend answers; on free hosting it sleeps when idle and takes about a minute to wake. */
export async function ping(signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(api("/api/health"), { signal });
    return r.ok;
  } catch {
    return false;
  }
}

export type SummaryLanguage = "auto" | "en" | "ar" | "fr";

/** Handlers for the progress stream the backend sends for summaries and chat. */
export type StreamHandlers = {
  onStage?: (stage: string) => void;
  /** Which provider and model is writing the answer, e.g. "Google Gemini · gemini-flash-lite-latest". */
  onModel?: (model: string) => void;
  onToken?: (text: string) => void;
  /** Evidence analysis: the state after each packet of the transcript. */
  onPacket?: (state: AdillahState) => void;
};

/** Reads the backend's stream of JSON lines: {stage}, {token}, {done} or {error}. */
async function readEvents(r: Response, handlers: StreamHandlers): Promise<unknown> {
  if (!r.ok || !r.body) throw await readError(r);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) throw new ApiError(event.error.code, event.error.message);
      if (event.stage) handlers.onStage?.(event.stage);
      if (event.model) handlers.onModel?.(event.model);
      if (event.token) handlers.onToken?.(event.token);
      if (event.packet) handlers.onPacket?.(event.packet);
      if ("done" in event) return event.done;
    }
  }
  throw new ApiError("interrupted", "The connection was interrupted before the answer finished. Please try again.");
}

export async function getSummary(
  videoId: string,
  style: SummaryStyle,
  language: SummaryLanguage,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const r = await fetch(api(`/api/videos/${videoId}/summary`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...keyHeaders() },
    body: JSON.stringify({ style, language }),
    signal,
  });
  return (await readEvents(r, handlers)) as string;
}

export async function streamChat(
  videoIds: string[],
  question: string,
  history: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(api("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...keyHeaders() },
    body: JSON.stringify({ video_ids: videoIds, question, history }),
    signal,
  });
  await readEvents(r, handlers);
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function parseTime(text: string): number {
  return text.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** Deletes the server's saved copy of a summary so the next request generates a fresh one. */
export async function clearSummary(videoId: string, style: SummaryStyle, language: SummaryLanguage): Promise<void> {
  const params = new URLSearchParams({ style, language });
  const r = await fetch(api(`/api/videos/${videoId}/summary?${params}`), { method: "DELETE" });
  if (!r.ok) throw await readError(r);
}

export type EvidenceType = "ayah" | "hadith" | "athar" | "qawl";
/**
 * verified: matches the trusted text. different: the same text, quoted with other wording.
 * translated: quoted in another language, so only the reference is known. unverified: not found
 * in the sources. reported: athar and scholars' sayings, shown as said in the video.
 */
export type EvidenceStatus = "verified" | "different" | "translated" | "unverified" | "reported";

export type Evidence = {
  type: EvidenceType;
  status: EvidenceStatus;
  said: string;
  times: number[];
  labels: string[];
  // ayah
  surah?: number;
  surah_name?: string;
  ayah_from?: number;
  ayah_to?: number;
  text?: string;
  // hadith
  narrator?: string;
  collection?: string;
  collection_name?: string;
  number?: string;
  full_text?: string;
  grades?: { by: string; grade: string }[];
  also_in?: { collection: string; collection_name: string; number: string }[];
  // athar and qawl
  person?: string;
  /** The correct wording from the source (with tashkeel) to show in the full text. */
  correct_text?: string;
  /** Each place the quote is said: first and last caption word as [segment index, word index]. */
  spans?: [[number, number], [number, number]][];
  /** The correct wording of each span (same order), or "" to show the words as said. */
  span_texts?: string[];
};

export type AdillahState = {
  items: Evidence[];
  /** partial: packets remain. complete: done. no_adillah: the first minutes had no evidence, so it stopped. */
  state: "partial" | "complete" | "no_adillah";
  /** Seconds of the video analysed so far. */
  analysed: number;
  duration: number;
  packet: number;
  packets: number;
};

/** Analyses the video packet by packet; `handlers.onPacket` receives the results after each one. */
export async function getAdillah(
  videoId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  force = false,
): Promise<AdillahState> {
  const r = await fetch(api(`/api/videos/${videoId}/adillah`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...keyHeaders() },
    body: JSON.stringify({ force }),
    signal,
  });
  return (await readEvents(r, handlers)) as AdillahState;
}

/** Deletes the server's saved evidence list so the next request finds it again. */
export async function clearAdillah(videoId: string): Promise<void> {
  const r = await fetch(api(`/api/videos/${videoId}/adillah`), { method: "DELETE" });
  if (!r.ok) throw await readError(r);
}
