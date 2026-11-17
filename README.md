# You Resumer

Paste YouTube links, get summaries, and ask questions answered only from the video content, with clickable timestamps. Works across up to 5 videos at once.

## Structure
- `backend/`: Python FastAPI. Fetches transcripts, caches them, picks the relevant pieces, and calls the AI model.
- `frontend/`: Next.js website. Forwards `/api/*` to the backend.

## Run locally
```bash
cd backend && uv run uvicorn app.main:app --reload --port 8000
```
```bash
cd frontend && npm run dev
```
Open http://localhost:3000.

## AI keys
The server keeps no AI key. Each visitor adds their own free key under 🔑 (Google Gemini, plus Groq as an optional backup); it is stored only in their browser and sent with their requests in the `X-Gemini-Key` / `X-Groq-Key` headers. Results are saved per video and shared, so a lecture analysed once is free for everyone after.

## Deploy (free, Render)
1. Push this repository to GitHub.
2. Create a free Postgres database at neon.tech and copy its connection string.
3. In Render: New → Blueprint → this repository. `render.yaml` creates the API (free web service) and the page (free static site). When asked, paste the Neon connection string as `DATABASE_URL` (in Render only, never in the code).

The free API sleeps after 15 minutes without visitors and takes about a minute to wake; the page shows "Waking up the server…". The Qur'an and hadith data are built during each deploy. YouTube often refuses captions to hosting servers: the page then asks the visitor to paste the transcript from YouTube's "Show transcript" panel. Limits per visitor: 30 new videos and 120 AI requests per hour, videos up to 3 hours.

## التفريغ (full text)
Under the video and panels, at full width. Built from the captions without any AI: lines joined with spaces, paragraphs at pauses. It follows the player (YouTube IFrame API), highlighting the spoken word (estimated within a few words); clicking a word jumps there. Quotes found by the evidence analysis are colored and shown in the source's correct wording. Copy, Word (.docx), Print, and an organized PDF: typeset on the server with Typst (no AI) with a cover, colored quotes, verse references, footnotes giving each hadith's source and grade, and indexes of verses, hadith and athar with page numbers. The Amiri fonts it uses are in `backend/fonts` (SIL Open Font License).

## Adillah (evidence)
Lists every Qur'an verse, hadith, Companion's athar and scholar's saying quoted in a video. It starts automatically when a video is added and runs in the background.
1. The transcript goes to the AI in ordered packets (2,000 characters first, then 4,000, overlapping by 2 lines); each packet's results show as soon as it returns, and are saved so an analysis resumes. If the first 2 packets have no verse, hadith or athar, it stops (non-Islamic content). When the AI is busy or the visitor has no key yet, it pauses and can be retried.
2. The AI only *points* to each quote (verse reference, the hadith it recognizes, who said it).
3. The text shown always comes from trusted local data, never from the AI: the Uthmani Qur'an with tashkeel (alquran.cloud / Tanzil) and nine hadith collections with grades (fawazahmed0/hadith-api).
4. Each quote is matched against that data by phrase and marked verified, different wording, or not found. Athar and scholars' sayings have no source to check and are shown as said in the video.

The data (about 7 MB download, 64 MB with search indexes) goes into `backend/sources.db`. It is built on first use, or ahead of time:
```bash
cd backend && uv run python -m app.sources
```

## API
- `POST /api/videos` `{url}`: load a video (cached).
- `POST /api/videos/paste` `{url, transcript}`: a video from a transcript copied from YouTube.
- `POST /api/videos/{id}/summary` `{style, language}`; `DELETE` the same path to clear the saved summary.
- `POST /api/videos/{id}/adillah` `{force}`: the verified evidence list, streamed as `{packet}` events after each packet; `DELETE` to clear it.
- `POST /api/chat` `{video_ids, question, history}`
- `POST /api/export/pdf`: the organized PDF of the text the page sends.
- `GET /api/health`

AI endpoints read the visitor's keys from the `X-Gemini-Key` and `X-Groq-Key` headers and stream JSON lines: `{stage}`, `{model}`, `{token}`, `{packet}`, `{error}`, then `{done}`.
