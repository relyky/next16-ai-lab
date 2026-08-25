import { NextResponse } from "next/server";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";

import { createChartsMcpServer } from "@/lib/charts/charts-mcp-server";
import type { ChatStreamEvent } from "@/lib/chat-stream";
import { getServerConfig } from "@/lib/server-config";

export const runtime = "nodejs";

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

  // 前端 fetch 的 AbortController 無法跨 HTTP 傳到後端；改為在此另建一個，
  // 由「用戶端斷線」與「回應串流被取消」兩個訊號觸發，讓 LLM 端一併停止產生。
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  request.signal.addEventListener("abort", abort);

  const config = getServerConfig();

  const options: Options = {
    abortController,
    model: config.model,
    // 一次工具往返最少兩個 turn（呼叫工具、依結果作答），
    // 留餘裕讓助手能連續查幾次再收斂出答案。
    maxTurns: 8,
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
    // 取得 content_block_delta 逐字增量事件。
    includePartialMessages: true,
  };

  // 伺服器端沒有人能按同意，未顯式放行的工具呼叫會被直接拒絕。
  // glob 錨定在字面的 mcp__<server>__ 之後，代表放行該 server 的全部工具。
  // qadb 是外部服務，靠環境變數給 URL；charts 是自家程式碼，直接掛實例。
  options.mcpServers = {
    ...(config.qadbMcpUrl
      ? { qadb: { type: "http" as const, url: config.qadbMcpUrl } }
      : {}),
    charts: createChartsMcpServer(),
  };
  options.allowedTools = [
    ...(config.qadbMcpUrl ? ["mcp__qadb__*"] : []),
    "mcp__charts__*",
  ];

  if (sessionId) {
    options.resume = sessionId;
  }

  const encoder = new TextEncoder();

  // NDJSON 串流，事件型別見 @/lib/chat-stream。
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 已中斷代表串流早已被取消，再 enqueue 或 close 只會拋例外。
      const send = (event: ChatStreamEvent) => {
        if (abortController.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const close = () => {
        if (abortController.signal.aborted) return;
        controller.close();
      };

      try {
        for await (const message of query({ prompt: promptText, options })) {
          // 中斷時尚未收到 done，先送出 session id 讓前端仍能接續下一則訊息。
          if (message.type === "system" && message.subtype === "init") {
            send({ type: "session", sessionId: message.session_id });
            continue;
          }

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

          close();
          return;
        }

        send({ type: "error", error: "LLM 沒有回應" });
      } catch (error) {
        // 中斷會讓 query() 拋 AbortError，但那是預期行為，send 已自行略過。
        send({
          type: "error",
          error: error instanceof Error ? error.message : "LLM 呼叫失敗",
        });
      }

      close();
    },

    cancel() {
      abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
