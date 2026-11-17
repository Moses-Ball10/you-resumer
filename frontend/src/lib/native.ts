"use client";

import type { Segment } from "./api";

/**
 * Captions fetched on the visitor's own device, inside the installed app.
 *
 * YouTube refuses many requests from hosting servers, but not from people's phones. A web page
 * cannot read YouTube (browsers forbid it), but the installed app (Capacitor) can make native
 * requests. The app fetches the captions itself, the same three steps as the Python library:
 * the video page, YouTube's player data (as its Android app), then the caption file, and sends
 * them to our server. On the website these functions are not used.
 */

type HttpResponse = { status: number; data: unknown; headers: Record<string, string> };
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    CapacitorHttp?: {
      request(options: {
        url: string;
        method: string;
        headers?: Record<string, string>;
        data?: unknown;
        responseType?: "text" | "json";
      }): Promise<HttpResponse>;
    };
  };
};

function capacitor(): CapacitorGlobal | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the installed app (Android), false on the website. */
export function isNativeApp(): boolean {
  return Boolean(capacitor()?.isNativePlatform?.() && capacitor()?.Plugins?.CapacitorHttp);
}

export class DeviceCaptionError extends Error {
  constructor(public code: "blocked" | "no_captions" | "unavailable" | "failed", message: string) {
    super(message);
  }
}

const INNERTUBE_CONTEXT = { client: { clientName: "ANDROID", clientVersion: "20.10.38" } };
const LANGUAGE_HEADERS = { "Accept-Language": "en-US" };

async function request(url: string, options: { method?: string; headers?: Record<string, string>; data?: unknown; json?: boolean } = {}) {
  const http = capacitor()?.Plugins?.CapacitorHttp;
  if (!http) throw new DeviceCaptionError("failed", "Not running in the app.");
  const r = await http.request({
    url,
    method: options.method ?? "GET",
    headers: options.headers,
    data: options.data,
    responseType: options.json ? "json" : "text",
  });
  if (r.status === 429) throw new DeviceCaptionError("blocked", "YouTube is limiting requests from this network. Try again later.");
  if (r.status >= 400) throw new DeviceCaptionError("failed", `YouTube answered ${r.status}.`);
  return r.data;
}

async function videoPage(videoId: string): Promise<{ html: string; cookie?: string }> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  let html = String(await request(url, { headers: LANGUAGE_HEADERS }));
  if (html.includes('action="https://consent.youtube.com/s"')) {
    // European consent page: accept it the way the library does, with a CONSENT cookie.
    const v = html.match(/name="v" value="(.*?)"/)?.[1];
    if (!v) throw new DeviceCaptionError("failed", "Could not pass YouTube's consent page.");
    const cookie = `CONSENT=YES+${v}`;
    html = String(await request(url, { headers: { ...LANGUAGE_HEADERS, Cookie: cookie } }));
    return { html, cookie };
  }
  return { html };
}

type Track = { baseUrl: string; languageCode: string; kind?: string };

function baseLang(code: string) {
  return code.split("-")[0].toLowerCase();
}

/** The track in the spoken language, as the server does (see backend/app/youtube.py). */
function pickTrack(tracks: Track[]): Track | undefined {
  const manual = tracks.filter((t) => t.kind !== "asr");
  const generated = tracks.filter((t) => t.kind === "asr");
  if (generated.length) {
    const spoken = baseLang(generated[0].languageCode);
    return manual.find((t) => baseLang(t.languageCode) === spoken) ?? generated[0];
  }
  if (manual.length === 1) return manual[0];
  return manual.find((t) => baseLang(t.languageCode) === "en") ?? manual[0];
}

function decode(text: string): string {
  // Caption text is HTML-escaped inside the XML (e.g. "&amp;#39;"); decode it, then drop tags.
  const area = document.createElement("textarea");
  area.innerHTML = text;
  return area.value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function parseCaptions(xml: string): Segment[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return Array.from(doc.getElementsByTagName("text"))
    .map((el) => ({
      start: Math.round(Number(el.getAttribute("start") ?? 0) * 100) / 100,
      duration: Math.round(Number(el.getAttribute("dur") ?? 0) * 100) / 100,
      text: decode(el.textContent ?? ""),
    }))
    .filter((s) => s.text);
}

/** The video's captions (in the spoken language), fetched from this device. */
export async function fetchCaptionsOnDevice(videoId: string): Promise<{ language: string; segments: Segment[] }> {
  const { html, cookie } = await videoPage(videoId);
  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)?.[1];
  if (!apiKey) {
    if (html.includes('class="g-recaptcha"')) throw new DeviceCaptionError("blocked", "YouTube asked for a captcha on this network.");
    throw new DeviceCaptionError("failed", "Could not read the YouTube page.");
  }
  const player = (await request(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...LANGUAGE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    data: { context: INNERTUBE_CONTEXT, videoId },
    json: true,
  })) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
  };
  const status = player.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") throw new DeviceCaptionError("blocked", "YouTube asked to sign in for this video.");
  if (status && status !== "OK") throw new DeviceCaptionError("unavailable", "This video is unavailable or private.");
  const track = pickTrack(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
  if (!track) throw new DeviceCaptionError("no_captions", "This video has no captions.");
  const segments = parseCaptions(String(await request(track.baseUrl.replace("&fmt=srv3", ""), { headers: LANGUAGE_HEADERS })));
  if (!segments.length) throw new DeviceCaptionError("no_captions", "This video's captions are empty.");
  return { language: track.languageCode, segments };
}
