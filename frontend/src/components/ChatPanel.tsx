"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, streamChat, type ChatMessage, type Video } from "@/lib/api";
import { RichText } from "./RichText";

type Props = { videos: Video[]; onSeek: (videoIndex: number, seconds: number) => void };

export function ChatPanel({ videos, onSeek }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    const history = messages;
    setInput("");
    setError("");
    setBusy(true);
    setMessages([...history, { role: "user", content: question }, { role: "assistant", content: "" }]);
    try {
      await streamChat(
        videos.map((v) => v.id),
        question,
        history,
        (token) =>
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + token };
            return copy;
          }),
      );
    } catch (err) {
      setMessages(history);
      setInput(question);
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted">
            <p className="font-medium text-fg">Ask anything about {videos.length > 1 ? "these videos" : "this video"}</p>
            <p className="mt-1 text-sm">Answers come only from the video content, with timestamps you can click.</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-white">
              {m.content}
            </div>
          ) : (
            <div key={i} className="max-w-[95%]">
              {m.content ? (
                <RichText text={m.content} onSeek={onSeek} />
              ) : (
                <span className="animate-pulse text-muted">Thinking…</span>
              )}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
