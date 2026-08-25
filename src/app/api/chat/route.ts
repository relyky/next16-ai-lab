import { NextResponse } from "next/server";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";

import type { ChatStreamEvent } from "@/lib/chat-stream";

export const runtime = "nodejs";

// 模型別名（'fable' | 'opus' | 'sonnet' | 'haiku'）或完整 model ID。
const DEFAULT_MODEL = "haiku";

const SYSTEM_PROMPT =
  "你是一位專業的財務助手，協助使用者理解財務報表與經營數據。" +
  "回答務必使用繁體中文，語氣專業、簡潔，並在資訊不足時主動說明。";

export async function POST(request: Request) {
  let prompt: unknown;
  let sessionId: unknown;
  try {
    ({ prompt, sessionId } = await request.json());
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "請輸入問題" }, { status: 400 });
  }
  const promptText = prompt;

  if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId)) {
    return NextResponse.json({ error: "sessionId 格式錯誤" }, { status: 400 });
  }

  const options: Options = {
    model: DEFAULT_MODEL,
    maxTurns: 1,
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
    // 取得 content_block_delta 逐字增量事件。
    includePartialMessages: true,
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  const encoder = new TextEncoder();

  // NDJSON 串流，事件型別見 @/lib/chat-stream。
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for await (const message of query({ prompt: promptText, options })) {
          if (message.type === "stream_event") {
            const { event } = message;
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ type: "delta", text: event.delta.text });
            }
            continue;
          }

          if (message.type !== "result") continue;

          if (message.subtype !== "success") {
            send({ type: "error", error: `LLM 回應失敗（${message.subtype}）` });
          } else if (message.is_error) {
            // subtype 為 success 但 is_error 時，result 承載的是錯誤文字。
            send({ type: "error", error: message.result });
          } else {
            // session_id 以本次結果為準：resume 有可能 fork 出新的 session。
            send({
              type: "done",
              result: message.result,
              sessionId: message.session_id,
            });
          }

          controller.close();
          return;
        }

        send({ type: "error", error: "LLM 沒有回應" });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "LLM 呼叫失敗",
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
