// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatStreamEvent } from "@/lib/chat-stream";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

type QueryArgs = { options: { abortController?: AbortController } };

/** 送出 init 與一段增量後停住，直到 options.abortController 被中止才拋 AbortError。 */
function stallingQuery() {
  let captured: QueryArgs["options"] | undefined;
  queryMock.mockImplementation(async function* (args: QueryArgs) {
    captured = args.options;
    yield { type: "system", subtype: "init", session_id: "s-1" };
    yield {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "本季" } },
    };
    await new Promise<never>((_, reject) => {
      args.options.abortController?.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError"))
      );
    });
  });
  return () => captured;
}

function chatRequest(init?: RequestInit) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ prompt: "這季營收如何？" }),
    ...init,
  });
}

/** 讀取串流直到收到指定型別的事件，回傳目前為止的所有事件與 reader。 */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  type: ChatStreamEvent["type"]
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: ChatStreamEvent[] = [];
  let buffer = "";
  while (!events.some((e) => e.type === type)) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
  }
  return { events, reader };
}

afterEach(() => {
  queryMock.mockReset();
});

describe("POST /api/chat", () => {
  it("串流一開始就送出 session 事件", async () => {
    stallingQuery();
    const { POST } = await import("./route");

    const res = await POST(chatRequest());
    const { events, reader } = await readUntil(res.body!, "delta");
    await reader.cancel();

    expect(events[0]).toEqual({ type: "session", sessionId: "s-1" });
  });

  it("用戶端中斷連線時，一併中止 LLM 呼叫", async () => {
    const captured = stallingQuery();
    const { POST } = await import("./route");

    const abort = new AbortController();
    const res = await POST(chatRequest({ signal: abort.signal }));
    const { reader } = await readUntil(res.body!, "delta");

    expect(captured()?.abortController?.signal.aborted).toBe(false);

    abort.abort();
    await reader.cancel();

    await vi.waitFor(() =>
      expect(captured()?.abortController?.signal.aborted).toBe(true)
    );
  });

  it("回應串流被取消時，一併中止 LLM 呼叫", async () => {
    const captured = stallingQuery();
    const { POST } = await import("./route");

    const res = await POST(chatRequest());
    const { reader } = await readUntil(res.body!, "delta");
    await reader.cancel();

    await vi.waitFor(() =>
      expect(captured()?.abortController?.signal.aborted).toBe(true)
    );
  });
});
