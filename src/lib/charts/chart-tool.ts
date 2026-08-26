/**
 * charts MCP tools 的共用輸入 schema 與轉換邏輯。
 *
 * 三個圖表 tool（line/bar/area）差異只在回傳的 `type`，
 * 因此驗證與轉換集中在此，各 tool 只負責帶入自己的 type。
 */
import { z } from "zod";

/** 笛卡兒圖類型（類別軸 × 多數列）；決定前端要 render 哪一種 recharts 圖表。 */
export const CARTESIAN_CHART_TYPES = ["line", "bar", "area"] as const;

export type CartesianChartType = (typeof CARTESIAN_CHART_TYPES)[number];

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
/** 各圖表共用的資料欄位；上限一致，LLM 對限制才有一致認知。 */
const dataSchema = z
  .array(z.record(z.string(), z.union([z.string(), z.number()])))
  .min(1)
  .max(MAX_DATA_ROWS)
  .describe(`圖表資料，物件陣列，1~${MAX_DATA_ROWS} 筆`);

export const chartInputShape = {
  title: z.string().min(1).optional().describe("圖表標題"),
  data: dataSchema,
  xKey: z.string().min(1).describe("作為 X 軸（字串類別軸）的欄位名稱，須存在於 data 中"),
  series: z
    .array(seriesSchema)
    .min(1)
    .max(MAX_SERIES)
    .describe(`要繪製的數列，1~${MAX_SERIES} 組`),
};

export const chartInputSchema = z.object(chartInputShape);

export type ChartInput = z.infer<typeof chartInputSchema>;

/**
 * 餅圖的輸入欄位：單一數列 × 多類別，因此沒有數列（series）概念。
 *
 * `nameKey` / `valueKey` 貼齊 recharts `Pie` 的 prop 命名，讀前端程式時零翻譯；
 * `valueKey` 較 recharts 的 `dataKey` 更明確地說明該欄位必須是數值。
 */
export const pieChartInputShape = {
  title: z.string().min(1).optional().describe("圖表標題"),
  data: dataSchema,
  nameKey: z.string().min(1).describe("作為扇形類別名稱的欄位，須存在於 data 中"),
  valueKey: z
    .string()
    .min(1)
    .describe("作為扇形數值的欄位，須存在於 data 中且各列皆為非負數值"),
};

/**
 * strict：誤把笛卡兒圖的 xKey / series 傳進來時直接被驗證擋下，
 * 而不是靜默忽略後畫出一張參數對不上的圖。
 */
export const pieChartInputSchema = z.strictObject(pieChartInputShape);

export type PieChartInput = z.infer<typeof pieChartInputSchema>;

/**
 * 笛卡兒圖定義：類別軸 × 多數列，涵蓋 line / bar / area。
 */
export const cartesianChartDefinitionSchema = chartInputSchema.extend({
  type: z.enum(CARTESIAN_CHART_TYPES),
});

export type CartesianChartDefinition = z.infer<typeof cartesianChartDefinitionSchema>;

/**
 * 餅圖定義：單一數列 × 多類別。
 *
 * 同輸入端採 strict：tool 產出與前端解析走同一份定義，
 * 兩端對「什麼是合法餅圖」的寬嚴也必須一致。
 */
export const pieChartDefinitionSchema = z.strictObject({
  ...pieChartInputShape,
  type: z.literal("pie"),
});

export type PieChartDefinition = z.infer<typeof pieChartDefinitionSchema>;

/**
 * 圖表定義 JSON：tool 的輸出，由前端 ChartCard 依 type 渲染。
 *
 * 以 `type` 為判別子的 discriminated union：各種圖表的資料形狀本質不同，
 * 共用一份 schema 會對其中一方說謊。新增圖表類型的模式因此固定為
 * 「一個 union 分支 + 一個渲染子元件」。詳見 docs/adr/0001。
 *
 * 同時作為 schema 匯出：tool 產出與前端解析走同一份定義，
 * 兩端才不會各自對「什麼是合法圖表」有不同認知。
 */
export const chartDefinitionSchema = z.discriminatedUnion("type", [
  cartesianChartDefinitionSchema,
  pieChartDefinitionSchema,
]);

export type ChartDefinition = z.infer<typeof chartDefinitionSchema>;

/** MCP `CallToolResult` 中我們會用到的部分。 */
export type ChartToolResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function toolError(message: string): ChartToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * schema 無從得知 data 實際有哪些欄位，指定的 key 是否對得上只能在執行期比對。
 * 對得上時回傳 null，對不上時回傳附有可用欄位清單的錯誤，讓 LLM 能自行修正重試。
 */
function assertKeyExists(
  label: string,
  key: string,
  availableKeys: string[]
): ChartToolResult | null {
  if (availableKeys.includes(key)) return null;
  return toolError(
    `${label} "${key}" 不存在於 data 中；可用欄位為：${availableKeys.join("、")}`
  );
}

function parseOrError<T>(
  schema: z.ZodType<T>,
  input: unknown
): { ok: true; value: T } | { ok: false; error: ChartToolResult } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("；");
  return { ok: false, error: toolError(`圖表參數驗證失敗 → ${details}`) };
}

/**
 * 驗證輸入並轉成圖表定義 JSON。
 *
 * 驗證失敗一律回傳 `isError: true` 與具體訊息，讓 LLM 能理解原因並自行重試，
 * 而不是靜默給出空圖表。
 */
export function buildChartResult(type: CartesianChartType, input: unknown): ChartToolResult {
  const parsed = parseOrError(chartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const { data, xKey } = parsed.value;

  const availableKeys = Object.keys(data[0]);
  const missingXKey = assertKeyExists("xKey", xKey, availableKeys);
  if (missingXKey) return missingXKey;

  const missingSeries = parsed.value.series
    .map((s) => s.key)
    .filter((key) => !availableKeys.includes(key));
  if (missingSeries.length > 0) {
    return toolError(
      `series 的欄位 ${missingSeries.map((k) => `"${k}"`).join("、")} 不存在於 data 中；` +
        `可用欄位為：${availableKeys.join("、")}`
    );
  }

  const definition: CartesianChartDefinition = { type, ...parsed.value };
  return { content: [{ type: "text", text: JSON.stringify(definition) }] };
}

/**
 * 驗證餅圖輸入並轉成圖表定義 JSON。
 *
 * 與笛卡兒圖分開而非共用同一個簽章：兩者的輸入型別已不同，
 * 硬塞同一個函式只是把 union 的分辨工作從型別系統推回函式內部。
 */
export function buildPieChartResult(input: unknown): ChartToolResult {
  const parsed = parseOrError(pieChartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const { data, nameKey, valueKey } = parsed.value;
  const availableKeys = Object.keys(data[0]);

  const missingNameKey = assertKeyExists("nameKey", nameKey, availableKeys);
  if (missingNameKey) return missingNameKey;

  const missingValueKey = assertKeyExists("valueKey", valueKey, availableKeys);
  if (missingValueKey) return missingValueKey;

  // 扇形角度直接由值決定，非數值或負數會畫出無意義的圖。
  // data 欄位的型別允許字串（類別名稱本來就是字串），此約束只能在執行期比對。
  for (const [index, row] of data.entries()) {
    const value = row[valueKey];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return toolError(
        `data 第 ${index + 1} 列的 ${valueKey} 值 ${JSON.stringify(value)} 不是數值；` +
          "餅圖的數值欄位每一列都必須是非負數值"
      );
    }
    if (value < 0) {
      return toolError(
        `data 第 ${index + 1} 列的 ${valueKey} 值 ${value} 為負數；` +
          "餅圖的數值欄位每一列都必須是非負數值"
      );
    }
  }

  const definition: PieChartDefinition = { type: "pie", ...parsed.value };
  return { content: [{ type: "text", text: JSON.stringify(definition) }] };
}
