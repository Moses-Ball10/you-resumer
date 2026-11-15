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

## AI model
The backend talks to any OpenAI-compatible server (Ollama locally, vLLM in production). Configure it in `backend/.env`:
```
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:3b
```
Without a model, loading videos and transcripts works; summaries and chat return a "model unavailable" message.

## API
- `POST /api/videos` `{url}`: load a video (cached).
- `POST /api/videos/{id}/summary` `{style: short|detailed|key_points|chapters}`
- `POST /api/chat` `{video_ids, question, history}`: streams the answer as text.
- `GET /api/health`
