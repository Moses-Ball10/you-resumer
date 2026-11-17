"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Video } from "@/lib/api";
import type { AdillahRun } from "@/lib/adillah";
import { copyText, downloadOrganizedPdf, downloadWord, printPdf } from "@/lib/export";
import { getPosition, isPlaying, subscribe, subscribePlaying, togglePlay } from "@/lib/playback";
import { buildDoc, wordAt, type Doc, type Unit } from "@/lib/tafrigh";
import { reference, STATUS, toArabicDigits, TYPES } from "./evidenceStyle";

type Props = {
  video: Video;
  videoIndex: number;
  onSeek: (videoIndex: number, seconds: number) => void;
  run?: AdillahRun;
  onStart: (options?: { force?: boolean }) => void;
  onStop: () => void;
};

/**
 * The full text of the video (التفريغ). It follows the player, highlighting the word being
 * spoken; clicking a word jumps there. Quotes found by the evidence analysis are colored, with
 * the correct wording from the source.
 */
export function Tafrigh({ video, videoIndex, onSeek, run, onStart, onStop }: Props) {
  const rtl = video.language.startsWith("ar");
  const data = run?.data;
  const islamic = data?.state !== "no_adillah";
  const items = useMemo(() => (islamic ? (data?.items ?? []) : []), [islamic, data?.items]);
  const doc = useMemo(() => buildDoc(video.segments, items), [video.segments, items]);

  // Words after the analysed part are greyed until their packet is analysed.
  const analysing = run?.status !== "done" || data?.state === "partial";
  const pendingFrom = useMemo(() => {
    if (!analysing || data?.state === "no_adillah") return -1;
    const at = data?.analysed ?? 0;
    const i = doc.words.findIndex((w) => w.t >= at);
    return i;
  }, [analysing, data?.state, data?.analysed, doc.words]);

  const seek = useCallback((t: number) => onSeek(videoIndex, t), [onSeek, videoIndex]);
  const [follow, setFollow] = useState(true);
  const [notice, setNotice] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // Highlight the spoken unit, directly in the DOM (the position changes 4 times a second).
  useEffect(() => {
    let current: Element | null = null;
    const update = ({ videoId, time }: { videoId: string; time: number }) => {
      const container = box.current;
      if (!container) return;
      const i = videoId === video.id ? wordAt(doc.words, time) : -1;
      const el = i >= 0 ? container.querySelector<HTMLElement>(`[data-h="${doc.markOfWord[i]}"]`) : null;
      if (el === current) return;
      current?.classList.remove("tafrigh-current", "tafrigh-current-quote");
      // Inside a quote the word gets its own color, distinct from the quote's color.
      el?.classList.add(el.dataset.q ? "tafrigh-current-quote" : "tafrigh-current");
      current = el;
      if (el && followRef.current) {
        const c = container.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.top < c.top + 40 || r.bottom > c.bottom - 40) {
          container.scrollTo({ top: container.scrollTop + r.top - c.top - c.height / 3, behavior: "smooth" });
        }
      }
    };
    update(getPosition());
    const unsubscribe = subscribe(update);
    return () => {
      unsubscribe();
      current?.classList.remove("tafrigh-current", "tafrigh-current-quote");
    };
  }, [doc, video.id]);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 2500);
  }

  const [making, setMaking] = useState(false);

  async function exportAs(kind: "copy" | "word" | "pdf" | "print") {
    const title = video.title || video.id;
    try {
      if (kind === "copy") {
        await copyText(doc);
        flash("Copied");
      } else if (kind === "word") {
        await downloadWord(doc, title, rtl);
      } else if (kind === "pdf") {
        setMaking(true);
        flash("Making the PDF…");
        await downloadOrganizedPdf(doc, video, rtl);
      } else {
        printPdf(doc, title, rtl);
      }
    } catch {
      flash("Could not export. Please try again.");
    } finally {
      setMaking(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2 lg:px-4 lg:py-2.5">
        {/* On phones the tab above already says التفريغ. */}
        <h2 className="hidden font-arabic text-lg font-bold lg:block">التفريغ</h2>
        <AnalysisStatus run={run} onStart={onStart} onStop={onStop} />
        {items.length > 0 && (
          <div dir="rtl" className="hidden flex-wrap items-center gap-3 font-arabic text-xs text-muted lg:flex">
            {(Object.keys(TYPES) as (keyof typeof TYPES)[]).map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span className={`h-2.5 w-2.5 rounded-sm ${TYPES[t].dot}`} aria-hidden />
                {TYPES[t].plural}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-sm lg:ml-auto lg:gap-2">
          {notice && <span className="text-xs text-muted">{notice}</span>}
          <PlayButton />
          <label className="flex cursor-pointer items-center gap-1.5 text-muted" title="Scroll the text to follow the video">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[var(--accent)]" />
            Follow<span className="hidden sm:inline"> video</span>
          </label>
          <ToolButton onClick={() => exportAs("copy")}>Copy</ToolButton>
          <ToolButton onClick={() => exportAs("word")}>Word</ToolButton>
          <ToolButton onClick={() => exportAs("print")}>Print</ToolButton>
          <button
            onClick={() => exportAs("pdf")}
            disabled={making}
            title="Organized PDF: cover, colored quotes with references, footnotes with sources and grades, and indexes"
            className="rounded-md border border-accent px-2.5 py-1 font-arabic text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            {making ? "…" : "PDF منظّم"}
          </button>
        </div>
      </header>
      <div
        ref={box}
        dir={rtl ? "rtl" : "ltr"}
        className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 lg:px-5 lg:py-4 ${rtl ? "font-arabic text-lg leading-[2.1] lg:text-xl lg:leading-[2.2]" : "text-base leading-8"}`}
      >
        <Paragraphs doc={doc} pendingFrom={pendingFrom} onSeek={seek} />
      </div>
    </div>
  );
}

/** Play/pause from the text, so the video can be stopped without scrolling back up to it. */
function PlayButton() {
  const [playing, setPlayingState] = useState(isPlaying());
  useEffect(() => subscribePlaying(setPlayingState), []);
  return (
    <button
      onClick={togglePlay}
      title={playing ? "Pause the video" : "Play the video"}
      className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white"
    >
      {playing ? "❚❚ Pause" : "▶ Play"}
    </button>
  );
}

function ToolButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg">
      {children}
    </button>
  );
}

/** "٧ دقائق", "١٨ دقيقة": Arabic uses the plural from 3 to 10. */
function minutes(seconds: number): string {
  const n = Math.max(1, Math.round(seconds / 60));
  return `${toArabicDigits(n)} ${n >= 3 && n <= 10 ? "دقائق" : "دقيقة"}`;
}

function AnalysisStatus({ run, onStart, onStop }: Pick<Props, "run" | "onStart" | "onStop">) {
  const data = run?.data;
  const base = "flex flex-wrap items-center gap-2 font-arabic text-sm";
  const link = "rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent";
  if (!run || run.status === "waiting") {
    return <span dir="rtl" className={`${base} text-muted`}>⏳ في انتظار تحليل الأدلة</span>;
  }
  if (run.status === "running") {
    return (
      <span dir="rtl" className={`${base} text-muted`} title={run.stage}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        {data ? `تحليل الأدلة: تم ${minutes(data.analysed)} من ${minutes(data.duration)}` : "تحليل الأدلة…"}
        <button onClick={onStop} className={link}>إيقاف</button>
      </span>
    );
  }
  if (run.status === "paused") {
    return (
      <span dir="rtl" className={`${base} text-yellow-700 dark:text-yellow-300`}>
        ⏸ متوقف
        {run.pause && <span className="text-xs text-muted">({run.pause.message})</span>}
        <button onClick={() => onStart()} className={link}>إعادة المحاولة</button>
      </span>
    );
  }
  if (run.status === "stopped") {
    return (
      <span dir="rtl" className={`${base} text-muted`}>
        ⏸ أُوقف التحليل
        <button onClick={() => onStart()} className={link}>متابعة</button>
      </span>
    );
  }
  if (data?.state === "no_adillah") {
    return (
      <span dir="rtl" className={`${base} text-muted`}>
        لا توجد أدلة شرعية في أول {minutes(data.analysed)}
        <button onClick={() => onStart({ force: true })} className={link}>متابعة التحليل</button>
      </span>
    );
  }
  return (
    <span dir="rtl" className={`${base} text-emerald-700 dark:text-emerald-300`}>
      ✓ اكتمل تحليل الأدلة ({toArabicDigits(data?.items.length ?? 0)})
    </span>
  );
}

/** The text itself. Memoized: it only changes when the evidence or the analysed part changes. */
const Paragraphs = memo(function Paragraphs({
  doc,
  pendingFrom,
  onSeek,
}: {
  doc: Doc;
  pendingFrom: number;
  onSeek: (seconds: number) => void;
}) {
  const [showOriginal, setShowOriginal] = useState<Set<number>>(new Set());

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLElement>("[data-original]");
    if (toggle) {
      const id = Number(toggle.dataset.original);
      setShowOriginal((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    const el = target.closest<HTMLElement>("[data-t]");
    if (el) onSeek(Number(el.dataset.t));
  }

  let markerShown = false;
  return (
    <div onClick={onClick}>
      {doc.paragraphs.map((para, p) => (
        <p key={p} className="mb-4">
          {para.map((u) => {
            const pending = pendingFrom >= 0 && u.from >= pendingFrom;
            const marker = pending && !markerShown;
            if (marker) markerShown = true;
            return (
              <span key={u.id}>
                {marker && (
                  <span className="mx-1 inline-block rounded-md border border-dashed border-line px-2 font-arabic text-xs leading-6 text-muted">
                    ⏳ لم يُحلَّل بعد
                  </span>
                )}
                <UnitView doc={doc} unit={u} pending={pending} original={showOriginal.has(u.id)} />{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
});

function UnitView({ doc, unit, pending, original }: { doc: Doc; unit: Unit; pending: boolean; original: boolean }) {
  const t = doc.words[unit.from].t.toFixed(2);
  if (unit.kind === "word") {
    return (
      <span data-h={unit.id} data-t={t} className={`cursor-pointer hover:underline ${pending ? "opacity-45" : ""}`}>
        {doc.words[unit.from].text}
      </span>
    );
  }
  const type = TYPES[unit.item.type];
  const status = STATUS[unit.item.status];
  const isAyah = unit.item.type === "ayah";
  return (
    <>
      <span
        data-t={t}
        title={`${type.label} · ${reference(unit.item)} · ${status.label}`}
        className={`cursor-pointer rounded px-1 py-0.5 underline decoration-2 underline-offset-[6px] ${type.inline} ${isAyah ? "font-quran" : ""}`}
      >
        {isAyah ? "﴿ " : "«"}
        {unit.tokens.map((tok, k) => (
          <span key={k}>
            {k > 0 && " "}
            <span data-h={`${unit.id}.${k}`} data-q="1" data-t={doc.words[tok.w].t.toFixed(2)}>
              {tok.text}
            </span>
          </span>
        ))}
        {isAyah ? " ﴾" : "»"}
        {unit.corrected && (
          <button
            data-original={unit.id}
            title="Corrected from the source. Click to see what was said in the video."
            className="ms-1 align-super font-sans text-[0.6em] no-underline opacity-80 hover:opacity-100"
          >
            ✎ مُصحَّح
          </button>
        )}
      </span>
      {original && (
        <span className="mx-1 rounded border border-dashed border-line px-1.5 text-[0.75em] text-muted">
          المقروء في المقطع: «{unit.original}»
        </span>
      )}
    </>
  );
}
