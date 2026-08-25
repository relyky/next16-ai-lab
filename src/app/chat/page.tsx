"use client";

import { useRef, useState } from "react";

import { ChartCard } from "@/components/chart-card";
import { ChatInput } from "@/components/chat-input";
import { Card } from "@/components/ui/card";
import type { ChartDefinition } from "@/lib/charts/chart-tool";
import type { ChatStreamEvent } from "@/lib/chat-stream";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** 本則回應中助手產生的圖表，依產生順序排列；只有 assistant 會有。 */
  charts?: ChartDefinition[];
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

function AssistantMessage({ text, charts }: { text: string; charts?: ChartDefinition[] }) {
  return (
    <div className="flex justify-start">
      {/* 有圖表時撐滿寬度，圖表才有可讀的尺寸；純文字則維持隨內容縮放。 */}
      <Card
        data-slot="assistant-message"
        className={charts?.length ? "w-[90%] p-0" : "max-w-[90%] p-0"}
      >
        {/* 圖表可能比文字先到；文字還沒有內容時不留空白區塊。 */}
        {text ? (
          <div className="px-4 py-3 text-sm whitespace-pre-wrap">{text}</div>
        ) : null}
        {charts?.length ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            {charts.map((chart, index) => (
              // 圖表沒有天然的識別碼，同一則回應中的順序即其身分。
              <ChartCard key={index} chart={chart} />
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(text: string) {
    const userMessageId = messages.length;
    const assistantMessageId = userMessageId + 1;
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: "user", text },
    ]);
    setLoading(true);

    // 助手訊息泡泡在第一個事件到達時才建立，之後就地更新。
    // 文字與圖表各自到達，故以「要改哪些欄位」為單位更新同一則訊息。
    const upsertReply = (patch: Partial<Omit<Message, "id" | "role">>) =>
      setMessages((prev) =>
        prev.some((m) => m.id === assistantMessageId)
          ? prev.map((m) =>
              m.id === assistantMessageId ? { ...m, ...patch } : m
            )
          : [
              ...prev,
              { id: assistantMessageId, role: "assistant", text: "", ...patch },
            ]
      );

    let accumulated = "";
    // 圖表事件不會重送，累積在本地才能與文字更新一起送進同一則訊息。
    const charts: ChartDefinition[] = [];
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, sessionId: sessionId ?? undefined }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // 串流尚未開始的錯誤（如格式驗證）仍是 JSON；解析失敗不該蓋掉真正的錯誤原因。
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `請求失敗（HTTP ${res.status}）`);
      }
      if (!res.body) {
        throw new Error("回應格式錯誤");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let handledAny = false;

      const handleLine = (line: string) => {
        if (!line.trim()) return;

        let event: ChatStreamEvent;
        try {
          event = JSON.parse(line);
        } catch {
          // 無法解析代表內容已經不完整，不能靜默吞掉。
          throw new Error("回應格式錯誤");
        }
        if (event.type === "session") {
          // 中斷時不會有 done，先記住 session id 才能接續下一則訊息。
          // session 不是回覆內容，單獨收到它不足以視為有效回應。
          setSessionId(event.sessionId);
          return;
        }
        handledAny = true;

        if (event.type === "delta") {
          accumulated += event.text;
          upsertReply({ text: accumulated });
        } else if (event.type === "chart") {
          charts.push(event.chart);
          upsertReply({ charts: [...charts] });
        } else if (event.type === "done") {
          setSessionId(event.sessionId);
          // 最終完整訊息為權威內容；若為空則保留已累積的增量。
          if (event.result) {
            accumulated = event.result;
            upsertReply({ text: accumulated });
          }
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // 最後一段可能是被切斷的半行。
        for (const line of lines) handleLine(line);
      }
      handleLine(buffer + decoder.decode()); // decode() 收尾未完成的多位元組字元。

      if (!handledAny) {
        throw new Error("回應格式錯誤");
      }
    } catch (err) {
      // 使用者主動中斷不是失敗：保留已浮現的內容，只加註標示。
      if (err instanceof DOMException && err.name === "AbortError") {
        const marker = "（已中斷）";
        upsertReply({ text: accumulated ? `${accumulated}\n\n${marker}` : marker });
        return;
      }

      const reason = err instanceof Error ? err.message : "未知錯誤";
      const notice = `抱歉，這次回覆失敗了：${reason}。請再試一次。`;
      // 已浮現的內容保留，錯誤提示接在後面。
      upsertReply({ text: accumulated ? `${accumulated}\n\n${notice}` : notice });
    } finally {
      abortRef.current = null;
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
            <AssistantMessage
              key={message.id}
              text={message.text}
              charts={message.charts}
            />
          )
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">財務助手思考中……</p>
        )}
      </div>

      <ChatInput
        onSubmit={handleSubmit}
        onAbort={() => abortRef.current?.abort()}
        disabled={loading}
      />
    </div>
  );
}
