/**
 * charts MCP server：以 Streamable HTTP transport host 在本專案內的 Route Handler。
 *
 * 這些 tool 不查詢任何資料源；資料由呼叫端（LLM，通常先呼叫 qadb 查好）
 * 當參數傳入，tool 只負責「資料 → 圖表定義 JSON」的轉換，
 * 實際渲染交給前端的 recharts 元件。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  buildChartResult,
  chartInputShape,
} from "@/lib/charts/chart-tool";

export const runtime = "nodejs";

function createServer() {
  const server = new McpServer(
    { name: "charts", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // 後續 bar/area tool 以相同方式註冊，只需換掉 buildChartResult 的 type。
  server.registerTool(
    "line_chart",
    {
      title: "折線圖",
      description:
        "把查到的資料轉成折線圖定義，適合呈現數值隨時間或順序的趨勢變化。" +
        "xKey 指定作為 X 軸的欄位（字串類別軸），series 指定要畫成線的數值欄位。",
      inputSchema: chartInputShape,
    },
    (args) => buildChartResult("line", args)
  );

  return server;
}

/**
 * 每個請求各自建立 server 與 transport（stateless）。
 *
 * Route Handler 在多個 serverless instance 間無法共享記憶體中的 session，
 * 而這些 tool 本身無狀態，不需要 session 也能正確運作。
 */
async function handle(request: Request): Promise<Response> {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
