/**
 * charts MCP server：以 SDK in-process server 形式提供圖表 tools。
 *
 * 這些 tool 不查詢任何資料源；資料由呼叫端（LLM，通常先呼叫 qadb 查好）
 * 當參數傳入，tool 只負責「資料 → 圖表定義 JSON」的轉換，
 * 實際渲染交給前端的 recharts 元件。
 *
 * 走 in-process 而非 HTTP：tool handler 就在同一個 process 裡，
 * 繞一圈 HTTP 回到自己只會多一次往返與一個必設的環境變數。
 * 代價是這些 tool 僅供本服務使用，不對外開放給其他 MCP client。
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

import { buildChartResult, chartInputShape } from "./chart-tool";

/** 三個 tool 只差在回傳的 type 與描述，共用同一份 schema 與轉換邏輯。 */
const SHARED_USAGE =
  "xKey 指定作為 X 軸的欄位（字串類別軸），series 指定要畫的數值欄位。";

export const lineChartTool = tool(
  "line_chart",
  "把查到的資料轉成折線圖定義，適合呈現數值隨時間或順序的趨勢變化。" + SHARED_USAGE,
  chartInputShape,
  async (args) => buildChartResult("line", args)
);

export const barChartTool = tool(
  "bar_chart",
  "把查到的資料轉成長條圖定義，適合比較不同類別之間的數值差異。" + SHARED_USAGE,
  chartInputShape,
  async (args) => buildChartResult("bar", args)
);

export const areaChartTool = tool(
  "area_chart",
  "把查到的資料轉成區域圖定義，適合呈現數量隨時間累積的變化幅度。" + SHARED_USAGE,
  chartInputShape,
  async (args) => buildChartResult("area", args)
);

/** 匯出成陣列，讓「有哪些 tool」在測試與註冊處是同一份來源。 */
export const chartTools = [lineChartTool, barChartTool, areaChartTool];

/** 掛進 chat route 的 `mcpServers.charts`；工具全名為 `mcp__charts__*`。 */
export function createChartsMcpServer() {
  return createSdkMcpServer({
    name: "charts",
    version: "0.1.0",
    tools: chartTools,
  });
}
