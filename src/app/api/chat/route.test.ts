// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatStreamEvent } from "@/lib/chat-stream";

const queryMock = vi.hoisted(() => vi.fn());

// 只換掉 query；tool / createSdkMcpServer 需維持真實，charts server 才建得起來。
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
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

/** 讀到串流真正結束為止，回傳所有事件。串流未能正常關閉時會在此拋出。 */
async function drain(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: ChatStreamEvent[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
  }
  return events;
}

afterEach(() => {
  queryMock.mockReset();
  vi.unstubAllEnvs();
});

/** 取出本次呼叫 LLM 時傳入的 options。 */
function capturedOptions() {
  return queryMock.mock.calls[0][0].options as {
    model?: string;
    maxTurns?: number;
    mcpServers?: Record<string, { type: string; url: string }>;
    allowedTools?: string[];
  };
}

/** 跑完一次請求，只為取得傳給 LLM 的 options。 */
async function captureOptions() {
  stallingQuery();
  const { POST } = await import("./route");

  const res = await POST(chatRequest());
  const { reader } = await readUntil(res.body!, "delta");
  await reader.cancel();

  return capturedOptions();
}

describe("POST /api/chat", () => {
  describe("MODEL 環境變數", () => {
    it("未設定時使用預設模型 haiku", async () => {
      vi.stubEnv("MODEL", undefined);

      expect((await captureOptions()).model).toBe("haiku");
    });

    it("已設定時改用指定的模型", async () => {
      vi.stubEnv("MODEL", "sonnet");

      expect((await captureOptions()).model).toBe("sonnet");
    });

    it("設定值前後的空白會被去除", async () => {
      vi.stubEnv("MODEL", "  claude-sonnet-5  ");

      expect((await captureOptions()).model).toBe("claude-sonnet-5");
    });

    it("設定值為純空白時視同未設定", async () => {
      vi.stubEnv("MODEL", "   ");

      expect((await captureOptions()).model).toBe("haiku");
    });
  });


  describe("QADB_MCP_URL 環境變數", () => {
    it("已設定時以 HTTP transport 掛上 qadb，並顯式放行其工具", async () => {
      vi.stubEnv("QADB_MCP_URL", "http://localhost:5152/graphql/mcp");

      const options = await captureOptions();

      expect(options.mcpServers?.qadb).toEqual({
        type: "http",
        url: "http://localhost:5152/graphql/mcp",
      });
      // 伺服器端沒有人能按同意，未放行的工具呼叫會被直接拒絕。
      expect(options.allowedTools).toContain("mcp__qadb__*");
    });

    it("未設定時不掛載 qadb、也不放行其工具", async () => {
      vi.stubEnv("QADB_MCP_URL", undefined);

      const options = await captureOptions();

      expect(options.mcpServers).not.toHaveProperty("qadb");
      expect(options.allowedTools).not.toContain("mcp__qadb__*");
    });

    it("設定值前後的空白會被去除", async () => {
      vi.stubEnv("QADB_MCP_URL", "  http://localhost:5152/graphql/mcp  ");

      const options = await captureOptions();

      expect(options.mcpServers?.qadb.url).toBe(
        "http://localhost:5152/graphql/mcp"
      );
    });

    it("設定值為純空白時視同未設定", async () => {
      vi.stubEnv("QADB_MCP_URL", "   ");

      const options = await captureOptions();

      expect(options.mcpServers).not.toHaveProperty("qadb");
      expect(options.allowedTools).not.toContain("mcp__qadb__*");
    });
  });

  describe("charts MCP server（in-process）", () => {
    it("一律掛載，不需環境變數，並顯式放行其工具", async () => {
      vi.stubEnv("QADB_MCP_URL", undefined);

      const options = await captureOptions();

      // in-process server 帶的是 live 的 McpServer 實例，不是 URL。
      expect(options.mcpServers?.charts).toMatchObject({
        type: "sdk",
        name: "charts",
      });
      expect(options.allowedTools).toEqual(["mcp__charts__*"]);
    });

    it("qadb 也設定時兩者並存，並各自放行", async () => {
      vi.stubEnv("QADB_MCP_URL", "http://localhost:5152/graphql/mcp");

      const options = await captureOptions();

      expect(options.mcpServers?.qadb).toEqual({
        type: "http",
        url: "http://localhost:5152/graphql/mcp",
      });
      expect(options.mcpServers?.charts).toMatchObject({ type: "sdk" });
      expect(options.allowedTools).toEqual(["mcp__qadb__*", "mcp__charts__*"]);
    });
  });

  describe("工具往返的 turn 上限", () => {
    it("turn 上限足以完成多次工具往返", async () => {
      // 一次工具往返最少兩個 turn；連續查幾次再收斂需要更多。
      // 斷言語意而非特定數字，日後調值不會誤紅。
      expect((await captureOptions()).maxTurns).toBeGreaterThanOrEqual(4);
    });
  });

  describe("工具往返不破壞串流事件流", () => {
    it("忽略中間的 tool_use 與 tool_result 訊息，且不外洩工具參數片段", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "我查一下。" },
          },
        };
        // 工具參數的逐字增量：不得被當成回覆文字送出。
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: '{"first":' },
          },
        };
        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t-1",
                name: "mcp__qadb__search_asvt_project_basic",
                input: { first: 5 },
              },
            ],
          },
        };
        yield {
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "t-1", content: "[...]" },
            ],
          },
        };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "共 5 個專案。" },
          },
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "共 5 個專案。",
          session_id: "s-1",
        };
      });
      const { POST } = await import("./route");

      const res = await POST(chatRequest());
      // drain 讀到串流自然結束，一併驗證工具往返後仍正常收尾關閉。
      const events = await drain(res.body!);

      expect(events).toEqual([
        { type: "session", sessionId: "s-1" },
        { type: "delta", text: "我查一下。" },
        { type: "delta", text: "共 5 個專案。" },
        { type: "done", result: "共 5 個專案。", sessionId: "s-1" },
      ]);
    });
  });

  describe("charts tool 產生的圖表", () => {
    const chart = (type: "line" | "bar" | "area", title: string) => ({
      type,
      title,
      data: [{ month: "1月", revenue: 120 }],
      xKey: "month",
      series: [{ key: "revenue" }],
    });

    /** 產生一次「呼叫圖表工具 → 拿到結果」的訊息往返。 */
    function chartRoundTrip(id: string, name: string, content: string) {
      return [
        {
          type: "assistant",
          message: { content: [{ type: "tool_use", id, name, input: {} }] },
        },
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: id, content }],
          },
        },
      ];
    }

    it("送出 chart 事件，且不干擾文字增量", async () => {
      const line = chart("line", "月營收");
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "我畫給你看。" },
          },
        };
        yield* chartRoundTrip("t-1", "mcp__charts__line_chart", JSON.stringify(line));
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "如圖所示。",
          session_id: "s-1",
        };
      });
      const { POST } = await import("./route");

      const res = await POST(chatRequest());
      const events = await drain(res.body!);

      expect(events).toEqual([
        { type: "session", sessionId: "s-1" },
        { type: "delta", text: "我畫給你看。" },
        { type: "chart", chart: line },
        { type: "done", result: "如圖所示。", sessionId: "s-1" },
      ]);
    });

    it("一則回應含多次圖表呼叫時，依序送出多個 chart 事件", async () => {
      const line = chart("line", "月營收");
      const bar = chart("bar", "各部門支出");
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield* chartRoundTrip("t-1", "mcp__charts__line_chart", JSON.stringify(line));
        yield* chartRoundTrip("t-2", "mcp__charts__bar_chart", JSON.stringify(bar));
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "兩張圖如上。",
          session_id: "s-1",
        };
      });
      const { POST } = await import("./route");

      const res = await POST(chatRequest());
      const events = await drain(res.body!);

      expect(events.filter((e) => e.type === "chart")).toEqual([
        { type: "chart", chart: line },
        { type: "chart", chart: bar },
      ]);
    });

    it("圖表工具失敗時不送出 chart 事件", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield* chartRoundTrip(
          "t-1",
          "mcp__charts__line_chart",
          "圖表參數驗證失敗 → xKey: 不存在"
        );
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "抱歉，畫不出來。",
          session_id: "s-1",
        };
      });
      const { POST } = await import("./route");

      const res = await POST(chatRequest());
      const events = await drain(res.body!);

      expect(events.some((e) => e.type === "chart")).toBe(false);
    });
  });

  it("LLM 正常回覆完畢時送出 done 並正常關閉串流", async () => {
    queryMock.mockImplementation(async function* () {
      yield { type: "system", subtype: "init", session_id: "s-1" };
      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "本季營收" },
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "本季營收成長 12%。",
        session_id: "s-1",
      };
    });
    const { POST } = await import("./route");

    const res = await POST(chatRequest());
    // 必須讀到串流「自然結束」而不是讀到 done 就罷手：
    // close() 在 done 入列之後才呼叫，提早離開就驗不到它。
    const events = await drain(res.body!);

    expect(events).toEqual([
      { type: "session", sessionId: "s-1" },
      { type: "delta", text: "本季營收" },
      { type: "done", result: "本季營收成長 12%。", sessionId: "s-1" },
    ]);
  });

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
