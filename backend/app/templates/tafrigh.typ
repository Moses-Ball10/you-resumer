// The organized transcript (تفريغ) of a video, typeset by Typst.
// All content arrives as JSON in sys.inputs.data, built by app/pdf.py, so no text is ever
// interpreted as Typst markup.

#let data = json(bytes(sys.inputs.data))
#let ar = data.rtl
#let pagenum = if ar { "١" } else { "1" }
#let colors = (
  ayah: rgb("#047857"),
  hadith: rgb("#0369A1"),
  athar: rgb("#B45309"),
  qawl: rgb("#6D28D9"),
)
#let accent = rgb("#9F1239")

#set document(title: data.title)
#set text(font: "Amiri", lang: if ar { "ar" } else { "en" }, dir: if ar { rtl } else { ltr }, size: 14pt)
#set par(justify: true, leading: 1em, spacing: 1.4em)
#set footnote(numbering: pagenum)
#set footnote.entry(separator: line(length: 30%, stroke: 0.5pt + luma(150)), gap: 0.5em)
#show footnote.entry: set text(size: 10.5pt)
#show heading: it => {
  set text(size: 18pt, fill: accent, weight: "bold")
  block(below: 1em, it.body)
}

// Page of the first quote marked with `key`, for the indexes.
#let page-of(key) = context {
  let found = query(<quote-mark>).filter(m => m.value == key)
  if found.len() > 0 { numbering(pagenum, ..counter(page).at(found.first().location())) }
}

#set page(
  paper: "a4",
  margin: (x: 2.2cm, top: 2.6cm, bottom: 2.3cm),
  // No header or page number on the cover (the first page).
  header: context {
    if here().page() > 1 [
      #set text(size: 9.5pt, fill: luma(110))
      #align(center, data.title)
      #v(-0.6em)
      #line(length: 100%, stroke: 0.4pt + luma(200))
    ]
  },
  footer: context {
    if here().page() > 1 {
      align(center, text(size: 10pt, fill: luma(90), numbering(pagenum, counter(page).get().first())))
    }
  },
)

// ---------------------------------------------------------------- cover
#align(center + horizon)[
  #text(size: 12pt, fill: luma(110), data.labels.kind)
  #v(1em)
  #text(size: 26pt, weight: "bold", fill: accent, data.title)
  #if data.speaker != "" [
    #v(0.8em)
    #text(size: 18pt, data.speaker)
  ]
  #v(2.5em)
  #line(length: 40%, stroke: 0.6pt + luma(180))
  #v(1.5em)
  #set text(size: 11.5pt, fill: luma(70))
  #grid(
    columns: 2,
    column-gutter: 1.2em,
    row-gutter: 0.8em,
    align: (end, start),
    ..data.facts.map(f => (strong(f.at(0)), f.at(1))).flatten(),
  )
  #if data.legend.len() > 0 [
    #v(2.5em)
    #set text(size: 11pt)
    #for l in data.legend [
      #box(baseline: 0.1em, rect(width: 0.8em, height: 0.8em, fill: colors.at(l.type), radius: 2pt))
      #h(0.3em) #l.label #h(1.2em)
    ]
  ]
]
#pagebreak()
#counter(page).update(1)

// ---------------------------------------------------------------- body
#for para in data.paragraphs {
  par(for r in para {
    if r.k == "t" {
      r.text + " "
    } else {
      let color = colors.at(r.type)
      let body = if r.type == "ayah" and r.from_source {
        text(font: "Amiri Quran", fill: color, size: 15pt)[﴿#r.text﴾]
      } else {
        text(fill: color, weight: "bold", "«" + r.text + "»")
      }
      [#metadata(r.key)<quote-mark>#body]
      if r.ref != "" { " " + text(size: 11pt, fill: luma(80), "[" + r.ref + "]") }
      if r.note != "" { footnote(r.note) }
      " "
    }
  })
}

// ---------------------------------------------------------------- indexes
#let index(title, entries) = {
  if entries.len() > 0 {
    pagebreak()
    heading(title)
    set text(size: 12pt)
    for e in entries {
      grid(
        columns: (1fr, auto, 2.5em),
        column-gutter: 1em,
        e.text, text(fill: luma(90), e.ref), align(end, page-of(e.key)),
      )
      v(0.5em, weak: true)
      line(length: 100%, stroke: 0.3pt + luma(220))
      v(0.5em, weak: true)
    }
  }
}

#index(data.labels.ayat, data.index.ayat)
#index(data.labels.ahadith, data.index.ahadith)
#index(data.labels.athar, data.index.athar)
