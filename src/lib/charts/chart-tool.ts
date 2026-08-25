/**
 * charts MCP tools 的共用輸入 schema 與轉換邏輯。
 *
 * 三個圖表 tool（line/bar/area）差異只在回傳的 `type`，
 * 因此驗證與轉換集中在此，各 tool 只負責帶入自己的 type。
 */
import { z } from "zod";

/**
 * 圖表類型；決定前端要 render 哪一種 recharts 圖表。
 *
 * 目前只註冊 line tool，bar/area 由後續票補上——列在此是為了讓
 * `buildChartResult` 屆時能原封不動被複用，不必回頭改動這個型別。
 */
export type ChartType = "line" | "bar" | "area";

/** 上限用途為避免 LLM 產生過大的資料集拖垮訊息大小與圖表可讀性。 */
const MAX_DATA_ROWS = 100;
const MAX_SERIES = 6;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const seriesSchema = z.object({
  key: z.string().min(1).describe("對應 data 中的欄位名稱"),
  label: z.string().min(1).optional().describe("圖例顯示名稱；未提供時使用 key"),
  color: z
    .string()
    .regex(HEX_COLOR, "color 需為 hex 格式（如 #4f46e5）")
    .optional()
    .describe("數列顏色，hex 格式；未提供時由前端套用預設配色"),
});

/**
 * 三個 chart tool 共用的輸入欄位。
 *
 * 以 raw shape 形式匯出，讓 `registerTool` 能直接取用並產生 JSON Schema。
 */
export const chartInputShape = {
  title: z.string().min(1).optional().describe("圖表標題"),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    .max(MAX_DATA_ROWS)
    .describe(`圖表資料，物件陣列，1~${MAX_DATA_ROWS} 筆`),
  xKey: z.string().min(1).describe("作為 X 軸（字串類別軸）的欄位名稱，須存在於 data 中"),
  series: z
    .array(seriesSchema)
    .min(1)
    .max(MAX_SERIES)
    .describe(`要繪製的數列，1~${MAX_SERIES} 組`),
};

export const chartInputSchema = z.object(chartInputShape);

export type ChartInput = z.infer<typeof chartInputSchema>;

/** 圖表定義 JSON：tool 的輸出，由前端 ChartCard 依 type 渲染。 */
export type ChartDefinition = ChartInput & { type: ChartType };

/** MCP `CallToolResult` 中我們會用到的部分。 */
export type ChartToolResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function toolError(message: string): ChartToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * 驗證輸入並轉成圖表定義 JSON。
 *
 * 驗證失敗一律回傳 `isError: true` 與具體訊息，讓 LLM 能理解原因並自行重試，
 * 而不是靜默給出空圖表。
 */
export function buildChartResult(type: ChartType, input: unknown): ChartToolResult {
  const parsed = chartInputSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("；");
    return toolError(`圖表參數驗證失敗 → ${details}`);
  }

  const { data, xKey } = parsed.data;

  // schema 無從得知 data 實際有哪些欄位，xKey 是否對得上只能在執行期比對。
  const availableKeys = Object.keys(data[0]);
  if (!availableKeys.includes(xKey)) {
    return toolError(
      `xKey "${xKey}" 不存在於 data 中；可用欄位為：${availableKeys.join("、")}`
    );
  }

  const missingSeries = parsed.data.series
    .map((s) => s.key)
    .filter((key) => !availableKeys.includes(key));
  if (missingSeries.length > 0) {
    return toolError(
      `series 的欄位 ${missingSeries.map((k) => `"${k}"`).join("、")} 不存在於 data 中；` +
        `可用欄位為：${availableKeys.join("、")}`
    );
  }

  const definition: ChartDefinition = { type, ...parsed.data };
  return { content: [{ type: "text", text: JSON.stringify(definition) }] };
}
