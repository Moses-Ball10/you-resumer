import type { Evidence, EvidenceType } from "@/lib/api";

/** One color per kind of evidence, used by the evidence cards and the full text. */
export const TYPES: Record<
  EvidenceType,
  { label: string; plural: string; icon: string; card: string; badge: string; dot: string; inline: string; hex: string }
> = {
  ayah: {
    label: "آية",
    plural: "الآيات",
    icon: "📖",
    card: "border-emerald-500/70 bg-emerald-500/[0.06]",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    inline: "bg-emerald-500/15 text-emerald-800 decoration-emerald-500 dark:text-emerald-200",
    hex: "047857",
  },
  hadith: {
    label: "حديث",
    plural: "الأحاديث",
    icon: "📜",
    card: "border-sky-500/70 bg-sky-500/[0.06]",
    badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
    inline: "bg-sky-500/15 text-sky-800 decoration-sky-500 dark:text-sky-200",
    hex: "0369A1",
  },
  athar: {
    label: "أثر صحابي",
    plural: "الآثار",
    icon: "👤",
    card: "border-amber-500/70 bg-amber-500/[0.06]",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    inline: "bg-amber-500/15 text-amber-800 decoration-amber-500 dark:text-amber-200",
    hex: "B45309",
  },
  qawl: {
    label: "قول عالم",
    plural: "أقوال العلماء",
    icon: "🎓",
    card: "border-violet-500/70 bg-violet-500/[0.06]",
    badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
    inline: "bg-violet-500/15 text-violet-800 decoration-violet-500 dark:text-violet-200",
    hex: "6D28D9",
  },
};

export const STATUS: Record<Evidence["status"], { label: string; className: string; title: string }> = {
  verified: {
    label: "✓ موثّق",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    title: "Matches the text in the trusted source",
  },
  different: {
    label: "≈ بلفظ مختلف",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    title: "The speaker quoted it with different wording; the correct text is shown",
  },
  translated: {
    label: "≈ ذُكر بالمعنى",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    title: "Quoted in another language; the reference was identified by the AI",
  },
  unverified: {
    label: "⚠ لم يُعثر عليه في المصادر",
    className: "bg-red-500/15 text-red-700 dark:text-red-300",
    title: "Not found in the Qur'an or the nine hadith collections; shown as said in the video",
  },
  reported: {
    label: "كما ورد في الفيديو",
    className: "bg-zinc-500/15 text-muted",
    title: "There is no trusted source to check this against; shown as the speaker said it",
  },
};

export function toArabicDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** Short reference of an item: "سورة النازعات ٤٠", "صحيح البخاري ٦٤٨٧", or who said it. */
export function reference(item: Evidence): string {
  if (item.surah_name) return `${item.surah_name} ${toArabicDigits(item.ayah_from ?? "")}`;
  if (item.collection_name) return `${item.collection_name} ${toArabicDigits(item.number ?? "")}`;
  return item.person ?? "";
}
