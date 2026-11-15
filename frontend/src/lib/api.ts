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

async function readError(r: Response): Promise<ApiError> {
  try {
    const body = await r.json();
    const d = body.detail;
    if (d?.code) return new ApiError(d.code, d.message);
    return new ApiError("error", typeof d === "string" ? d : "Something went wrong.");
  } catch {
    return new ApiError("error", "The server is not reachable. Please try again.");
  }
}

export async function loadVideo(url: string): Promise<Video> {
  const r = await fetch("/api/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) throw await readError(r);
  return r.json();
}

export async function getSummary(videoId: string, style: SummaryStyle): Promise<string> {
  const r = await fetch(`/api/videos/${videoId}/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style }),
  });
  if (!r.ok) throw await readError(r);
  return (await r.json()).content;
}

export async function streamChat(
  videoIds: string[],
  question: string,
  history: ChatMessage[],
  onToken: (text: string) => void,
): Promise<void> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_ids: videoIds, question, history }),
  });
  if (!r.ok || !r.body) throw await readError(r);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onToken(decoder.decode(value, { stream: true }));
  }
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
