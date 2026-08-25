"use client";

import { useState } from "react";

import { ChatInput } from "@/components/chat-input";
import { Card } from "@/components/ui/card";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl bg-primary px-4 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <Card className="max-w-[90%] p-0">
        <div className="px-4 py-3 text-sm whitespace-pre-wrap">{text}</div>
      </Card>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(text: string) {
    const baseId = messages.length;
    setMessages((prev) => [...prev, { id: baseId, role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, sessionId: sessionId ?? undefined }),
      });
      // 伺服器可能回非 JSON 的錯誤頁，先確保解析失敗不會蓋掉真正的錯誤原因。
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error ?? `請求失敗（HTTP ${res.status}）`);
      }
      if (typeof data?.result !== "string") {
        throw new Error("回應格式錯誤");
      }

      if (typeof data.sessionId === "string") {
        setSessionId(data.sessionId);
      }
      setMessages((prev) => [
        ...prev,
        { id: baseId + 1, role: "assistant", text: data.result },
      ]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "未知錯誤";
      setMessages((prev) => [
        ...prev,
        {
          id: baseId + 1,
          role: "assistant",
          text: `抱歉，這次回覆失敗了：${reason}。請再試一次。`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <div className="flex flex-1 flex-col gap-4 py-8">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            輸入你的財務問題，開始與財務助手對話。
          </p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <UserMessage key={message.id} text={message.text} />
          ) : (
            <AssistantMessage key={message.id} text={message.text} />
          )
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">財務助手思考中……</p>
        )}
      </div>

      <ChatInput onSubmit={handleSubmit} disabled={loading} />
    </div>
  );
}
