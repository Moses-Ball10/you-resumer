import { TYPES } from "@/components/evidenceStyle";
import { API_URL, type Evidence, type Video } from "./api";
import { plainText, quoteText, type Doc } from "./tafrigh";

function fileName(title: string, ext: string): string {
  const base = (title || "transcript").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80);
  return `${base} - تفريغ.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(doc: Doc): Promise<void> {
  const text = plainText(doc);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Some browsers and embedded views refuse the clipboard API; the older way still works there.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy failed");
  }
}

/** A Word file with the title, the paragraphs, and the quotes in their colors. */
export async function downloadWord(doc: Doc, title: string, rtl: boolean): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");
  const font = rtl ? "Traditional Arabic" : "Calibri";
  const size = rtl ? 32 : 24; // half-points
  const run = (text: string, extra: Record<string, unknown> = {}) =>
    new TextRun({ text, font: { name: font, cs: font }, size, sizeComplexScript: size, rightToLeft: rtl, ...extra });

  const paragraphs = doc.paragraphs.map(
    (para) =>
      new Paragraph({
        bidirectional: rtl,
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { after: 200, line: 360 },
        children: para.flatMap((u, k) => {
          const space = k ? " " : "";
          if (u.kind === "word") return [run(space + doc.words[u.from].text)];
          return [run(space), run(quoteText(u), { color: TYPES[u.item.type].hex, bold: true, boldComplexScript: true })];
        }),
      }),
  );
  const file = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [run(title, { bold: true, size: 40, sizeComplexScript: 40 })],
          }),
          ...paragraphs,
        ],
      },
    ],
  });
  download(await Packer.toBlob(file), fileName(title, "docx"));
}

/** "تمسكوا بعهد ابن مسعود (24) | الشيخ محمد غيث" -> the title and the speaker. */
export function splitTitle(title: string): { title: string; speaker: string } {
  const parts = title.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? { title: parts.slice(0, -1).join(" | "), speaker: parts[parts.length - 1] } : { title, speaker: "" };
}

/**
 * The organized PDF, typeset on the server: a cover, the text with colored quotes, references
 * after verses, footnotes with each hadith's source and grade, and indexes. No AI is used.
 */
export async function downloadOrganizedPdf(doc: Doc, video: Video, rtl: boolean): Promise<void> {
  const items: Evidence[] = [];
  const indexOf = new Map<Evidence, number>();
  const paragraphs = doc.paragraphs.map((para) => {
    const runs: Record<string, unknown>[] = [];
    let words: string[] = [];
    const flush = () => {
      if (words.length) runs.push({ k: "t", text: words.join(" ") });
      words = [];
    };
    for (const u of para) {
      if (u.kind === "word") {
        words.push(doc.words[u.from].text);
        continue;
      }
      flush();
      if (!indexOf.has(u.item)) {
        indexOf.set(u.item, items.length);
        items.push(u.item);
      }
      runs.push({ k: "q", item: indexOf.get(u.item), text: u.text, original: u.original, corrected: u.corrected });
    }
    flush();
    return runs;
  });
  const { title, speaker } = splitTitle(video.title || video.id);
  const r = await fetch(`${API_URL}/api/export/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      speaker,
      url: `https://youtu.be/${video.id}`,
      duration: video.duration,
      rtl,
      items,
      paragraphs,
    }),
  });
  if (!r.ok) throw new Error(`PDF export failed (${r.status})`);
  download(await r.blob(), fileName(title, "pdf"));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Opens a print view; the browser's print dialog saves it as PDF (with correct Arabic shaping). */
export function printPdf(doc: Doc, title: string, rtl: boolean): void {
  const body = doc.paragraphs
    .map((para) => {
      const html = para
        .map((u) =>
          u.kind === "word"
            ? escapeHtml(doc.words[u.from].text)
            : `<b style="color:#${TYPES[u.item.type].hex}">${escapeHtml(quoteText(u))}</b>`,
        )
        .join(" ");
      return `<p>${html}</p>`;
    })
    .join("\n");
  const win = window.open("", "_blank");
  if (!win) {
    alert("Allow pop-ups for this site to save the PDF.");
    return;
  }
  win.document.write(`<!doctype html><html lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head>
<meta charset="utf-8"><title>${escapeHtml(title)} - تفريغ</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap">
<style>
  body { font-family: ${rtl ? "'Amiri', serif" : "system-ui, sans-serif"}; font-size: ${rtl ? "17pt" : "12pt"};
         line-height: 1.9; color: #111; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4em; margin-bottom: 1.5rem; }
  p { margin: 0 0 1rem; text-align: justify; }
</style></head><body><h1>${escapeHtml(title)}</h1>${body}
<script>document.fonts.ready.then(() => setTimeout(() => print(), 300));</script></body></html>`);
  win.document.close();
}

