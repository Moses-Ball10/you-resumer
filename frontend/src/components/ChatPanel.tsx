"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, type ChatMessage, type Video } from "@/lib/api";
import type { TaskQueue } from "@/lib/queue";
import { RichText } from "./RichText";
import { TaskStatusLine } from "./Working";

/** A chat turn. Each question has one answer, filled in by its queued task. */
export type Turn = { taskId: string; question: string; answer: string; model?: string };
export type ChatStore = Record<string, Turn[]>;

type Props = {
  videos: Video[];
  onSeek: (videoIndex: number, seconds: number) => void;
  queue: TaskQueue;
  chats: ChatStore;
  setChats: React.Dispatch<React.SetStateAction<ChatStore>>;
};

export function ChatPanel({ videos, onSeek, queue, chats, setChats }: Props) {
  const chatKey = videos.map((v) => v.id).join(",");
  const turns = chats[chatKey] ?? [];
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  // Latest turns, read when a queued question actually starts, so its history includes earlier answers.
  const latest = useRef(chats);
  latest.current = chats;

  const lastAnswer = turns.at(-1)?.answer;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, lastAnswer]);

  const chatBusy = turns.some((t) => {
    const status = queue.get(t.taskId)?.status;
    return status === "running" || status === "waiting";
  });

  function clearChat() {
    setChats((all) => {
      const next = { ...all };
      delete next[chatKey];
      return next;
    });
  }

  function updateTurn(taskId: string, changes: Partial<Turn>) {
    setChats((all) => ({
      ...all,
      [chatKey]: (all[chatKey] ?? []).map((t) => (t.taskId === taskId ? { ...t, ...changes } : t)),
    }));
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question) return;
    setInput("");
    const videoIds = videos.map((v) => v.id);
    const taskId = queue.enqueue("chat", `Question — ${question}`, async (signal, setStage) => {
      const earlier = (latest.current[chatKey] ?? []).filter((t) => t.taskId !== taskId && t.answer);
      const history: ChatMessage[] = earlier.slice(-3).flatMap((t) => [
        { role: "user" as const, content: t.question },
        { role: "assistant" as const, content: t.answer },
      ]);
      let answer = "";
      updateTurn(taskId, { answer: "", model: undefined });
      await streamChat(
        videoIds,
        question,
        history,
        {
          onStage: setStage,
          onModel: (model) => updateTurn(taskId, { model }),
          onToken: (token) => {
            answer += token;
            updateTurn(taskId, { answer });
          },
        },
        signal,
      );
    });
    setChats((all) => ({ ...all, [chatKey]: [...(all[chatKey] ?? []), { taskId, question, answer: "" }] }));
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted">
            <p className="font-medium text-fg">Ask anything about {videos.length > 1 ? "these videos" : "this video"}</p>
            <p className="mt-1 text-sm">Answers come only from the video content, with timestamps you can click.</p>
          </div>
        )}
        {turns.map((turn) => {
          const task = queue.get(turn.taskId);
          const busy = task?.status === "running" || task?.status === "waiting";
          return (
            <div key={turn.taskId} className="space-y-2">
              <div dir="auto" className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-white">
                {turn.question}
              </div>
              <div dir="auto" className="max-w-[95%] space-y-2">
                {turn.answer && <RichText text={turn.answer} onSeek={onSeek} />}
                {turn.answer && turn.model && !busy && (
                  <p className="text-xs text-muted" title="The AI provider and model that wrote this answer">
                    Answered by {turn.model}
                  </p>
                )}
                {task && busy && (
                  <TaskStatusLine task={task} position={queue.position(task.id)} onCancel={() => queue.cancel(task.id)} />
                )}
                {task?.status === "cancelled" && <p className="text-sm text-muted">Cancelled.</p>}
                {task?.status === "failed" && <p className="text-sm text-danger">{task.error}</p>}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {turns.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={clearChat}
            disabled={chatBusy}
            title={chatBusy ? "Wait for the current questions to finish or cancel them first" : "Remove all questions and answers"}
            className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear chat
          </button>
        </div>
      )}
      <form onSubmit={send} className="flex gap-2">
        <input
          dir="auto"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <button
          disabled={!input.trim()}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
