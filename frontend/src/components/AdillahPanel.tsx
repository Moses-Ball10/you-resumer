"use client";

import { useState } from "react";
import type { Evidence, EvidenceType, Video } from "@/lib/api";
import type { AdillahRun } from "@/lib/adillah";
import { STATUS, toArabicDigits, TYPES } from "./evidenceStyle";

function gradeColor(grade: string): string {
  if (/ضعيف|موضوع|منكر|باطل|شاذ/.test(grade)) return "bg-red-500/15 text-red-700 dark:text-red-300";
  if (/حسن/.test(grade) && !/صحيح/.test(grade)) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
}

type Props = {
  video: Video;
  videoIndex: number;
  onSeek: (videoIndex: number, seconds: number) => void;
  run?: AdillahRun;
  onRestart: () => Promise<void>;
};

/** The evidence cards. The analysis itself runs in the background (see useAdillah). */
export function AdillahPanel({ video, videoIndex, onSeek, run, onRestart }: Props) {
  const data = run?.data;
  const items = data?.state === "no_adillah" ? [] : data?.items;
  const [filter, setFilter] = useState<EvidenceType | "all">("all");
  const [clearing, setClearing] = useState(false);
  const busy = run?.status === "running" || run?.status === "waiting";

  async function restart() {
    setClearing(true);
    try {
      await onRestart();
      setFilter("all");
    } finally {
      setClearing(false);
    }
  }

  const counts = (Object.keys(TYPES) as EvidenceType[]).map((t) => [t, items?.filter((i) => i.type === t).length ?? 0] as const);
  const shown = items?.filter((i) => filter === "all" || i.type === filter) ?? [];

  return (
    <div className="flex h-full flex-col gap-3">
      {items && items.length > 0 && (
        <div dir="rtl" className="flex flex-wrap items-center gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            الكل ({toArabicDigits(items.length)})
          </FilterChip>
          {counts.map(
            ([t, n]) =>
              n > 0 && (
                <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
                  <span className={`h-2 w-2 rounded-full ${TYPES[t].dot}`} aria-hidden />
                  {TYPES[t].plural} ({toArabicDigits(n)})
                </FilterChip>
              ),
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {(!items || items.length === 0) && (
          <div dir="rtl" className="flex flex-1 flex-col items-center justify-center gap-2 text-center font-arabic text-muted">
            {busy ? (
              <p>⏳ جارٍ تحليل الأدلة في «{video.title || video.id}»… تظهر النتائج هنا أولاً بأول.</p>
            ) : data?.state === "no_adillah" ? (
              <p>لا توجد أدلة شرعية في أول دقائق المقطع. يمكن متابعة التحليل من شريط التفريغ.</p>
            ) : data ? (
              <p>لم يُعثر على أدلة مقتبسة في هذا المقطع.</p>
            ) : (
              <p>حالة التحليل تظهر في شريط التفريغ أسفل الصفحة.</p>
            )}
          </div>
        )}

        {shown.map((item, i) => (
          <EvidenceCard key={`${item.type}-${item.times[0]}-${i}`} item={item} onSeek={(t) => onSeek(videoIndex, t)} />
        ))}

        {data && !busy && (
          <div className="mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
            {run?.model && (
              <span className="mr-auto text-xs text-muted" title="The AI provider and model that found the evidence">
                Found by {run.model} · texts from the Qur&apos;an and hadith collections
              </span>
            )}
            <button
              onClick={restart}
              disabled={clearing}
              title="Delete this analysis and its saved copy, and analyse the video again"
              className="rounded-md border border-line px-3 py-1 text-sm text-muted hover:border-danger hover:text-danger disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear and re-analyse"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-arabic text-sm transition ${
        active ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function EvidenceCard({ item, onSeek }: { item: Evidence; onSeek: (seconds: number) => void }) {
  const type = TYPES[item.type];
  const status = STATUS[item.status];
  return (
    <article dir="rtl" className={`space-y-3 rounded-xl border-s-4 p-4 ${type.card}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 font-arabic text-sm font-bold ${type.badge}`}>
          {type.icon} {type.label}
        </span>
        <span className={`rounded-md px-2 py-0.5 font-arabic text-xs ${status.className}`} title={status.title}>
          {status.label}
        </span>
        <span className="ms-auto flex flex-wrap gap-1" dir="ltr">
          {item.times.map((t, i) => (
            <button
              key={t}
              onClick={() => onSeek(t)}
              title="Jump to this moment"
              className="rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent hover:bg-accent/25"
            >
              {item.labels[i]}
            </button>
          ))}
        </span>
      </header>
      {item.type === "ayah" && <AyahBody item={item} />}
      {item.type === "hadith" && <HadithBody item={item} />}
      {(item.type === "athar" || item.type === "qawl") && <SayingBody item={item} />}
    </article>
  );
}

function SaidNote({ said, label }: { said: string; label: string }) {
  return (
    <p className="font-arabic text-sm leading-loose text-muted">
      <span className="font-bold">{label}: </span>«{said}»
    </p>
  );
}

function AyahBody({ item }: { item: Evidence }) {
  if (!item.text) {
    return <p className="font-arabic text-lg leading-loose">«{item.said}»</p>;
  }
  const range =
    item.ayah_to && item.ayah_to !== item.ayah_from
      ? `${toArabicDigits(item.ayah_from!)}–${toArabicDigits(item.ayah_to)}`
      : toArabicDigits(item.ayah_from!);
  return (
    <>
      <p className="text-center font-quran text-2xl leading-[2.4] text-fg">﴿ {item.text} ﴾</p>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 font-arabic text-sm text-muted">
        <span className="font-bold text-fg">
          {item.surah_name} : {range}
        </span>
        <a
          href={`https://quran.com/${item.surah}/${item.ayah_from}${item.ayah_to && item.ayah_to !== item.ayah_from ? `-${item.ayah_to}` : ""}`}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          عرض في المصحف ↗
        </a>
      </footer>
      {item.status !== "verified" && <SaidNote said={item.said} label="لفظ المتحدث" />}
    </>
  );
}

function HadithBody({ item }: { item: Evidence }) {
  const [open, setOpen] = useState(false);
  const searchWords = item.said.split(/\s+/).slice(0, 10).join(" ");
  return (
    <>
      <p className="font-arabic text-lg leading-loose text-fg">«{item.said}»</p>
      {item.full_text && (
        <div>
          <button onClick={() => setOpen(!open)} className="font-arabic text-sm text-accent hover:underline">
            {open ? "إخفاء النص الكامل ▴" : "عرض الحديث كاملاً ▾"}
          </button>
          {open && (
            <p className="mt-2 rounded-lg border border-line bg-surface p-3 font-arabic text-lg leading-loose">
              {item.full_text}
            </p>
          )}
        </div>
      )}
      <footer className="space-y-1.5 font-arabic text-sm text-muted">
        {item.narrator && <p>الراوي: {item.narrator}</p>}
        {item.collection_name && (
          <p className="font-bold text-fg">
            المصدر: {item.collection_name} ({toArabicDigits(item.number ?? "")})
          </p>
        )}
        {item.grades && item.grades.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span>الحكم:</span>
            {item.grades.map((g, i) => (
              <span key={i} className={`rounded-md px-2 py-0.5 text-xs ${gradeColor(g.grade)}`}>
                {g.by ? `${g.by}: ` : ""}
                {g.grade}
              </span>
            ))}
          </div>
        )}
        {item.also_in && item.also_in.length > 0 && (
          <p>
            ورد أيضاً في: {item.also_in.map((a) => `${a.collection_name} (${toArabicDigits(a.number)})`).join("، ")}
          </p>
        )}
        <a
          href={`https://dorar.net/hadith/search?q=${encodeURIComponent(searchWords)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-accent hover:underline"
        >
          البحث في الدرر السنية ↗
        </a>
      </footer>
    </>
  );
}

function SayingBody({ item }: { item: Evidence }) {
  return (
    <>
      <p className="font-arabic text-lg leading-loose text-fg">«{item.said}»</p>
      {item.person && <p className="font-arabic text-sm font-bold text-fg">— {item.person}</p>}
    </>
  );
}
