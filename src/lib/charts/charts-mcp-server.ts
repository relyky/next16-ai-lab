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

import {
  areaChartInputShape,
  barChartInputShape,
  buildAreaChartResult,
  buildBarChartResult,
  buildLineChartResult,
  buildPieChartResult,
  buildRadarChartResult,
  buildScatterChartResult,
  DEFAULT_BUBBLE_RADIUS_RANGE,
  lineChartInputShape,
  MAX_BUBBLE_RADIUS,
  pieChartInputShape,
  radarChartInputShape,
  scatterChartInputShape,
} from "./chart-tool";

/** 三個笛卡兒圖 tool 共通的用法說明；各自的差異寫在自己的描述裡。 */
const SHARED_USAGE =
  "xKey 指定作為 X 軸的欄位（字串類別軸），series 指定要畫的數值欄位。" +
  "配色以每組數列一色：可於 series[].color 傳 hex 色碼指定；未提供時前端套用預設配色。";

export const lineChartTool = tool(
  "line_chart",
  "把查到的資料轉成折線圖定義，適合呈現數值隨時間或順序的趨勢變化。" + SHARED_USAGE,
  lineChartInputShape,
  async (args) => buildLineChartResult(args)
);

/**
 * `stacked` 為選填且不設 schema 預設值，JSON Schema 因此不會帶 `default`，
 * LLM 無從得知未傳時會發生什麼——故各自的預設值必須在描述裡明文寫出。
 */
export const barChartTool = tool(
  "bar_chart",
  "把查到的資料轉成長條圖定義，適合比較不同類別之間的數值差異。" +
    SHARED_USAGE +
    "多數列時預設並排；使用者要求把數列疊起來時傳 stacked: true。",
  barChartInputShape,
  async (args) => buildBarChartResult(args)
);

export const areaChartTool = tool(
  "area_chart",
  "把查到的資料轉成區域圖定義，適合呈現數量隨時間累積的變化幅度。" +
    SHARED_USAGE +
    "多數列時預設堆疊；使用者要求各數列獨立比較、不該相加時傳 stacked: false。",
  areaChartInputShape,
  async (args) => buildAreaChartResult(args)
);

export const pieChartTool = tool(
  "pie_chart",
  "把查到的資料轉成餅圖定義，適合呈現各項目佔整體的組成比例。" +
    "nameKey 指定作為扇形類別名稱的欄位，valueKey 指定作為扇形數值的欄位（須為非負數值）。" +
    "餅圖只有單一數列，不接受 xKey 或 series。" +
    "配色以每個扇形一色：在 data 內另備一個 hex 色碼欄位並以 colorKey 指向它；" +
    "未提供 colorKey（或某列無值）時前端套用預設配色。",
  pieChartInputShape,
  async (args) => buildPieChartResult(args)
);

/**
 * 雷達圖：多維度指標的整體輪廓比較。
 *
 * 半徑軸不標刻度數字這件事不寫進描述——那是前端的呈現取捨，
 * 與 LLM 該傳什麼參數無關；描述只寫呼叫端真正需要知道的東西。
 */
export const radarChartTool = tool(
  "radar_chart",
  "把查到的資料轉成雷達圖定義，適合比較多個受評對象在數個評比面向上的整體輪廓，" +
    "一眼看出誰在哪些面向強、哪些面向弱。" +
    "angleKey 指定作為角度軸（各評比面向）的欄位，series 指定要畫的數值欄位（每個受評對象一組）。" +
    "配色以每組數列一色：可於 series[].color 傳 hex 色碼指定；未提供時前端套用預設配色。",
  radarChartInputShape,
  async (args) => buildRadarChartResult(args)
);

/**
 * 散佈圖：兩個數值變數的分布與相關性，外加選填的氣泡大小維度。
 *
 * `sizeKey` 與 `range` 的用法必須寫進**描述**而不是只寫在欄位的 describe 裡：
 * 選填欄位的說明只存在於巢狀 JSON Schema 的 property description 中，LLM 未必
 * 讀得到（ADR 0003 已記錄此問題）。氣泡大小是本功能最有價值的部分，
 * 若 LLM 從不主動使用，等於沒做。
 */
export const scatterChartTool = tool(
  "scatter_chart",
  "把查到的資料轉成散佈圖定義，適合觀察兩個數值變數之間的分布與相關性。" +
    "xKey 指定作為 X 軸的欄位，series 指定作為 Y 軸的數值欄位；" +
    "X 軸與各數列 key 都必須是數值欄位（可為負數），非數值會被拒絕。" +
    "配色以每組數列一色：可於 series[].color 傳 hex 色碼指定；未提供時前端套用預設配色。" +
    "要在同一張圖上多讀一個維度時，用選填的 sizeKey 指向一個非負數值欄位，" +
    "各點會依該值畫成大小不同的氣泡；未提供 sizeKey 時所有點大小相同。" +
    `選填的 range 是氣泡的 [最小半徑, 最大半徑]（單位 px，最大半徑上限 ${MAX_BUBBLE_RADIUS}），` +
    `未提供時前端套用預設 [${DEFAULT_BUBBLE_RADIUS_RANGE.join(", ")}]；` +
    "range 須與 sizeKey 同時提供。",
  scatterChartInputShape,
  async (args) => buildScatterChartResult(args)
);

/** 匯出成陣列，讓「有哪些 tool」在測試與註冊處是同一份來源。 */
export const chartTools = [
  lineChartTool,
  barChartTool,
  areaChartTool,
  pieChartTool,
  radarChartTool,
  scatterChartTool,
];

/** 掛進 chat route 的 `mcpServers.charts`；工具全名為 `mcp__charts__*`。 */
export function createChartsMcpServer() {
  return createSdkMcpServer({
    name: "charts",
    version: "0.1.0",
    tools: chartTools,
  });
}
