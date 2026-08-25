// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { GET, POST, DELETE } from "./route";

const ENDPOINT = new URL("http://localhost/api/mcp/charts");

/** 把 MCP client 的 HTTP 請求直接導進 Route Handler，不需真的起一個 server。 */
const routeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input instanceof Request ? input : String(input), init);
  switch (request.method) {
    case "GET":
      return GET(request);
    case "DELETE":
      return DELETE(request);
    default:
      return POST(request);
  }
};

const clients: Client[] = [];

async function connectClient() {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(ENDPOINT, { fetch: routeFetch })
  );
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const validArgs = {
  title: "月營收趨勢",
  data: [
    { month: "1月", revenue: 120 },
    { month: "2月", revenue: 150 },
  ],
  xKey: "month",
  series: [{ key: "revenue", label: "營收" }],
};

/** callTool 的回傳型別是 union，取出其中的 text content 串接成字串。 */
function textOf(result: Record<string, unknown>) {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content.map((c) => c.text ?? "").join("\n");
}

/** 解析 tool result 內的圖表定義 JSON。 */
function chartOf(result: Record<string, unknown>) {
  return JSON.parse(textOf(result));
}

describe("charts MCP route handler", () => {
  it("可被 MCP client 連線並列出 line chart tool", async () => {
    const client = await connectClient();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toContain("line_chart");
  });

  it("正常輸入回傳 type 為 line 的圖表定義 JSON", async () => {
    const client = await connectClient();

    const result = await client.callTool({ name: "line_chart", arguments: validArgs });

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "line", ...validArgs });
  });

  // 其餘驗證規則的邊界情境已在 chart-tool.test.ts 覆蓋；
  // 這裡只確認 isError 與錯誤訊息能正確經由 MCP transport 傳回。
  it("驗證失敗時 isError 與錯誤訊息能經由 transport 傳回", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "line_chart",
      arguments: { ...validArgs, xKey: "quarter" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("quarter");
  });
});
