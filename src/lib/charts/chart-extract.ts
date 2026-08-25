/**
 * 從 LLM 訊息流中挑出 charts MCP tool 產生的圖表定義。
 *
 * 圖表定義不會出現在助手的文字回覆裡，而是藏在回答 tool_use 的 tool_result 中；
 * 而 tool_result 本身只帶 `tool_use_id`、不帶工具名稱，因此必須先記下
 * 哪些 tool_use 是 charts server 發出的，才能在結果到達時對得起來。
 *
 * 只靠 schema 驗證不夠：其他 server（如 qadb）的回傳內容若碰巧同型，
 * 會被誤畫成圖表。故以「來源是 charts tool」為主、schema 驗證為輔。
 */
import { chartDefinitionSchema, type ChartDefinition } from "./chart-tool";

/** charts server 的工具全名前綴；與 route 掛載時的 server 名稱一致。 */
const CHARTS_TOOL_PREFIX = "mcp__charts__";

type ContentBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  text?: unknown;
  is_error?: unknown;
};

function contentBlocks(message: unknown): ContentBlock[] {
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

/**
 * tool_result 的 content 可能是純字串，也可能是 content block 陣列。
 * 兩種形式都攤平成單一字串再交給 schema 判讀。
 */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("");
}

function parseChart(text: string): ChartDefinition | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // tool 回報錯誤時 content 是人類可讀的訊息，不是 JSON。
    return null;
  }
  const parsed = chartDefinitionSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * 建立一個有狀態的擷取器：依序餵入訊息，回傳該則訊息帶出的圖表定義。
 *
 * 狀態即「已知屬於 charts 的 tool_use id」，因此一次對話要用同一個擷取器。
 */
export function createChartExtractor() {
  const chartToolUseIds = new Set<string>();

  return function extractCharts(message: unknown): ChartDefinition[] {
    const type = (message as { type?: unknown })?.type;

    if (type === "assistant") {
      for (const block of contentBlocks(message)) {
        if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string" &&
          block.name.startsWith(CHARTS_TOOL_PREFIX)
        ) {
          chartToolUseIds.add(block.id);
        }
      }
      return [];
    }

    if (type !== "user") return [];

    const charts: ChartDefinition[] = [];
    for (const block of contentBlocks(message)) {
      if (block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;
      if (!chartToolUseIds.has(block.tool_use_id)) continue;
      if (block.is_error === true) continue;

      const chart = parseChart(resultText(block.content));
      if (chart) charts.push(chart);
    }
    return charts;
  };
}
