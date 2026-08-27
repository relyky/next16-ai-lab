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

/** 補齊 ModelUsage 中本功能未使用的欄位，測試只需寫出四項 token 數。 */
function modelUsage(partial: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    ...partial,
  };
}

/** 事件流斷言用：以 modelUsage({}) 收尾的輪次會送出這個全零的 usage 事件。 */
const zeroUsageEvent = { type: "usage", in: 0, cache_c: 0, cache_r: 0, out: 0 };

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
    it("工具往返只帶出名稱與狀態，不外洩工具參數片段", async () => {
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
          modelUsage: { haiku: modelUsage({}) },
        };
      });
      const { POST } = await import("./route");

      const res = await POST(chatRequest());
      // drain 讀到串流自然結束，一併驗證工具往返後仍正常收尾關閉。
      const events = await drain(res.body!);

      expect(events).toEqual([
        { type: "session", sessionId: "s-1" },
        { type: "delta", text: "我查一下。" },
        {
          type: "tool_use",
          id: "t-1",
          name: "mcp__qadb__search_asvt_project_basic",
        },
        { type: "tool_done", id: "t-1", ok: true },
        { type: "delta", text: "共 5 個專案。" },
        zeroUsageEvent,
        { type: "done", result: "共 5 個專案。", sessionId: "s-1" },
      ]);
      // 工具參數（input 與其逐字增量）不得出現在任何事件裡。
      expect(JSON.stringify(events)).not.toContain("first");
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
          modelUsage: { haiku: modelUsage({}) },
        };
      });
      const { POST } = await import("./route");

      const res = await POST(chatRequest());
      const events = await drain(res.body!);

      expect(events).toEqual([
        { type: "session", sessionId: "s-1" },
        { type: "delta", text: "我畫給你看。" },
        { type: "tool_use", id: "t-1", name: "mcp__charts__line_chart" },
        { type: "tool_done", id: "t-1", ok: true },
        { type: "chart", chart: line },
        zeroUsageEvent,
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

  describe("工具呼叫歷程", () => {
    /** 產生一次「呼叫工具 → 拿到結果」的訊息往返。 */
    function toolRoundTrip(
      id: string,
      name: string,
      content: unknown,
      isError = false
    ) {
      return [
        {
          type: "assistant",
          message: { content: [{ type: "tool_use", id, name, input: {} }] },
        },
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: id,
                content,
                ...(isError ? { is_error: true } : {}),
              },
            ],
          },
        },
      ];
    }

    /** 跑一次請求，回傳串流吐出的全部事件。 */
    async function runStream(messages: unknown[]) {
      queryMock.mockImplementation(async function* () {
        yield* messages;
      });
      const { POST } = await import("./route");
      const res = await POST(chatRequest());
      return drain(res.body!);
    }

    const successResult = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "好的。",
      session_id: "s-1",
      modelUsage: { haiku: modelUsage({}) },
    };

    it("依序送出 tool_use 與 tool_done", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip("t-1", "mcp__qadb__search_asvt_project_basic", "[...]"),
        successResult,
      ]);

      expect(events).toEqual([
        { type: "session", sessionId: "s-1" },
        { type: "tool_use", id: "t-1", name: "mcp__qadb__search_asvt_project_basic" },
        { type: "tool_done", id: "t-1", ok: true },
        zeroUsageEvent,
        { type: "done", result: "好的。", sessionId: "s-1" },
      ]);
    });

    it("工具名稱以原始全名送出，不做前綴剝除", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip("t-1", "mcp__charts__bar_chart", "{}"),
        successResult,
      ]);

      expect(events).toContainEqual({
        type: "tool_use",
        id: "t-1",
        name: "mcp__charts__bar_chart",
      });
    });

    it("工具失敗時 ok 為 false，並帶上失敗訊息", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip("t-1", "mcp__qadb__query", "連線逾時", true),
        successResult,
      ]);

      expect(events).toContainEqual({
        type: "tool_done",
        id: "t-1",
        ok: false,
        message: "連線逾時",
      });
    });

    it("超長的失敗訊息被截斷並加上省略號", async () => {
      const long = "錯".repeat(300);
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip("t-1", "mcp__qadb__query", long, true),
        successResult,
      ]);

      const done = events.find((e) => e.type === "tool_done");
      expect(done).toMatchObject({ id: "t-1", ok: false });
      const message = (done as { message: string }).message;
      expect(message).toBe(`${"錯".repeat(100)}…`);
    });

    it("失敗訊息以 content block 陣列傳來時同樣可讀出", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip(
          "t-1",
          "mcp__charts__line_chart",
          [{ type: "text", text: "圖表參數驗證失敗" }],
          true
        ),
        successResult,
      ]);

      expect(events).toContainEqual({
        type: "tool_done",
        id: "t-1",
        ok: false,
        message: "圖表參數驗證失敗",
      });
    });

    it("孤兒 tool_result（無對應 tool_use）不產生事件", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "unknown", content: "x" }],
          },
        },
        successResult,
      ]);

      expect(events.some((e) => e.type === "tool_done")).toBe(false);
    });

    it("多個工具呼叫時事件順序正確", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip("t-1", "mcp__qadb__query", "[...]"),
        ...toolRoundTrip("t-2", "mcp__charts__bar_chart", "{}"),
        successResult,
      ]);

      expect(
        events.filter((e) => e.type === "tool_use" || e.type === "tool_done")
      ).toEqual([
        { type: "tool_use", id: "t-1", name: "mcp__qadb__query" },
        { type: "tool_done", id: "t-1", ok: true },
        { type: "tool_use", id: "t-2", name: "mcp__charts__bar_chart" },
        { type: "tool_done", id: "t-2", ok: true },
      ]);
    });

    it("同一則 assistant 訊息含多個 tool_use 時全部送出", async () => {
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "t-1", name: "mcp__qadb__a", input: {} },
              { type: "tool_use", id: "t-2", name: "mcp__qadb__b", input: {} },
            ],
          },
        },
        successResult,
      ]);

      expect(events.filter((e) => e.type === "tool_use")).toEqual([
        { type: "tool_use", id: "t-1", name: "mcp__qadb__a" },
        { type: "tool_use", id: "t-2", name: "mcp__qadb__b" },
      ]);
    });

    it("圖表工具的 tool_use 事件排在其 chart 事件之前", async () => {
      const chart = {
        type: "line",
        title: "月營收",
        data: [{ month: "1月", revenue: 120 }],
        xKey: "month",
        series: [{ key: "revenue" }],
      };
      const events = await runStream([
        { type: "system", subtype: "init", session_id: "s-1" },
        ...toolRoundTrip("t-1", "mcp__charts__line_chart", JSON.stringify(chart)),
        successResult,
      ]);

      const types = events.map((e) => e.type);
      expect(types.indexOf("tool_use")).toBeLessThan(types.indexOf("chart"));
      expect(types.indexOf("tool_done")).toBeLessThan(types.indexOf("chart"));
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
        modelUsage: {
          haiku: modelUsage({
            inputTokens: 3,
            cacheCreationInputTokens: 11604,
            cacheReadInputTokens: 0,
            outputTokens: 442,
          }),
        },
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
      { type: "usage", in: 3, cache_c: 11604, cache_r: 0, out: 442 },
      { type: "done", result: "本季營收成長 12%。", sessionId: "s-1" },
    ]);
  });

  describe("usage 事件", () => {
    it("跨多個模型加總四項用量", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "好的。",
          session_id: "s-1",
          modelUsage: {
            haiku: modelUsage({
              inputTokens: 3,
              cacheCreationInputTokens: 100,
              cacheReadInputTokens: 20,
              outputTokens: 40,
            }),
            sonnet: modelUsage({
              inputTokens: 7,
              cacheCreationInputTokens: 5,
              cacheReadInputTokens: 80,
              outputTokens: 2,
            }),
          },
        };
      });
      const { POST } = await import("./route");

      const events = await drain((await POST(chatRequest())).body!);

      expect(events).toContainEqual({
        type: "usage",
        in: 10,
        cache_c: 105,
        cache_r: 100,
        out: 42,
      });
    });

    it("排在 done 之前送出", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "好的。",
          session_id: "s-1",
          modelUsage: { haiku: modelUsage({ outputTokens: 1 }) },
        };
      });
      const { POST } = await import("./route");

      const types = (await drain((await POST(chatRequest())).body!)).map(
        (e) => e.type
      );

      expect(types).toContain("usage");
      expect(types.indexOf("usage")).toBeLessThan(types.indexOf("done"));
    });

    it("中斷的輪次不送出 usage 事件", async () => {
      // 刻意讓 query() 在中斷「之後」才吐出帶 modelUsage 的 result：
      // 若實作漏了中斷檢查，用量就會外洩，此測試才咬得住。
      let released!: () => void;
      const abortSeen = new Promise<void>((resolve) => {
        released = resolve;
      });
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "本季" },
          },
        };
        await abortSeen;
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "本季營收成長 12%。",
          session_id: "s-1",
          modelUsage: { haiku: modelUsage({ inputTokens: 3, outputTokens: 442 }) },
        };
      });
      const { POST } = await import("./route");

      const abort = new AbortController();
      const res = await POST(chatRequest({ signal: abort.signal }));
      const { events, reader } = await readUntil(res.body!, "delta");

      // 中斷後才放行 result。續讀同一個 reader：中斷後串流不再有事件，
      // 故此處應等到「無更多資料」而非讀到 usage。
      abort.abort();
      released();

      const next = await Promise.race([
        reader.read().then(() => "有事件" as const),
        new Promise<"沒有更多事件">((resolve) =>
          setTimeout(() => resolve("沒有更多事件"), 50)
        ),
      ]);
      await reader.cancel();

      expect(next).toBe("沒有更多事件");
      expect(events.some((e) => e.type === "usage")).toBe(false);
    });

    it("失敗的輪次一樣送出 usage：那些 token 確實已消耗", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          session_id: "s-1",
          modelUsage: { haiku: modelUsage({ inputTokens: 5, outputTokens: 9 }) },
        };
      });
      const { POST } = await import("./route");

      const events = await drain((await POST(chatRequest())).body!);

      expect(events).toContainEqual({
        type: "usage",
        in: 5,
        cache_c: 0,
        cache_r: 0,
        out: 9,
      });
    });

    it("is_error 的成功輪次一樣送出 usage", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "API 過載",
          session_id: "s-1",
          modelUsage: { haiku: modelUsage({ outputTokens: 7 }) },
        };
      });
      const { POST } = await import("./route");

      const events = await drain((await POST(chatRequest())).body!);

      expect(events).toContainEqual({
        type: "usage",
        in: 0,
        cache_c: 0,
        cache_r: 0,
        out: 7,
      });
    });

    it("usage 排在 error 之前：前端收到 error 就中止解析，排在後面會漏接", async () => {
      queryMock.mockImplementation(async function* () {
        yield { type: "system", subtype: "init", session_id: "s-1" };
        yield {
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          session_id: "s-1",
          modelUsage: { haiku: modelUsage({ outputTokens: 9 }) },
        };
      });
      const { POST } = await import("./route");

      const types = (await drain((await POST(chatRequest())).body!)).map(
        (e) => e.type
      );

      expect(types).toContain("usage");
      expect(types.indexOf("usage")).toBeLessThan(types.indexOf("error"));
    });
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
