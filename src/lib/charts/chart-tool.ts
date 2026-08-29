/**
 * charts MCP tools 的輸入 schema 與轉換邏輯。
 *
 * 每個 tool 各有一份輸入 shape 與一個具名轉換函式，
 * 共通的欄位定義與檢查邏輯則抽為此檔內部的常數與 helper。
 */
import { z } from "zod";

/**
 * 笛卡兒圖類型（類別軸 × 多數列）；決定前端要 render 哪一種 recharts 圖表。
 *
 * 各圖表定義的 `type` 由自己的 `z.literal` 決定，此別名只供前端的類型對照表使用。
 */
export type CartesianChartType = "line" | "bar" | "area";

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

/** 各圖表共用的資料欄位；上限一致，LLM 對限制才有一致認知。 */
const dataSchema = z
  .array(z.record(z.string(), z.union([z.string(), z.number()])))
  .min(1)
  .max(MAX_DATA_ROWS)
  .describe(`圖表資料，物件陣列，1~${MAX_DATA_ROWS} 筆`);

/**
 * 三個笛卡兒圖共有的輸入欄位。
 *
 * 三個 tool 各自擁有獨立的輸入 shape（才能各自增減欄位、各自拒絕未知欄位），
 * 但共通欄位的定義只寫在這一處，由各 shape 展開後再加上自己的差異。
 */
const cartesianCommonShape = {
  title: z.string().min(1).optional().describe("圖表標題"),
  data: dataSchema,
  xKey: z.string().min(1).describe("作為 X 軸（字串類別軸）的欄位名稱，須存在於 data 中"),
  series: z
    .array(seriesSchema)
    .min(1)
    .max(MAX_SERIES)
    .describe(`要繪製的數列，1~${MAX_SERIES} 組`),
};

/**
 * 各笛卡兒圖 tool 的輸入欄位；以 raw shape 形式匯出供 `tool()` 產生 JSON Schema。
 *
 * 目前三份內容相同，但刻意不合為一份：後續各圖要有自己的欄位（如僅 bar/area 的
 * `stacked`），共用一份會讓某個 tool 的簽章對呼叫端說謊。
 */
export const lineChartInputShape = { ...cartesianCommonShape };

/**
 * bar/area 專有的堆疊開關。
 *
 * 選填且不設 schema 層預設值：圖表定義 JSON 保持稀疏，LLM 沒傳就沒有這個欄位，
 * 「哪種圖預設堆疊」的回退規則統一由前端的類型對照表決定。也因為選填欄位不會在
 * JSON Schema 產生 `default`，各自的預設值必須寫進 tool 描述，LLM 才知道要顯式傳值。
 *
 * 折線圖不提供：堆疊折線容易被讀者誤讀成獨立值而非累加值。
 */
const stackedField = z
  .boolean()
  .optional()
  .describe("是否把各數列堆疊起來；未提供時採該圖表類型的預設");

export const barChartInputShape = { ...cartesianCommonShape, stacked: stackedField };

export const areaChartInputShape = { ...cartesianCommonShape, stacked: stackedField };

/**
 * strict：傳入未知欄位時直接被驗證擋下，而不是靜默忽略後畫出一張參數對不上的圖。
 * 這也是各圖能明確拒絕「不屬於自己的欄位」的前提。比照餅圖既有作法。
 */
export const lineChartInputSchema = z.strictObject(lineChartInputShape);
export const barChartInputSchema = z.strictObject(barChartInputShape);
export const areaChartInputSchema = z.strictObject(areaChartInputShape);

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
  /**
   * 餅圖的顏色層級是「每個扇形一色」，裝不進笛卡兒圖的「每組數列一色」結構，
   * 故不沿用 series；改為貼齊餅圖既有的 `*Key` 慣例——指向 data 內的欄位。
   */
  colorKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      "作為扇形顏色的欄位，須存在於 data 中且各列皆為 hex 色碼（如 #4f46e5）；" +
        "未提供時由前端套用預設配色"
    ),
};

/**
 * strict：誤把笛卡兒圖的 xKey / series 傳進來時直接被驗證擋下，
 * 而不是靜默忽略後畫出一張參數對不上的圖。
 */
export const pieChartInputSchema = z.strictObject(pieChartInputShape);

export type PieChartInput = z.infer<typeof pieChartInputSchema>;

/**
 * 雷達圖的輸入欄位：類別軸 × 多數列，與笛卡兒圖同構，只是軸換成極座標。
 *
 * 共用「數列」與「資料」兩個常數，但**不**沿用 `cartesianCommonShape`——
 * 後者的 `xKey` 語意是「字串類別軸」，雷達圖沒有 X 軸，借用只會讓名稱說謊。
 * 角度軸欄位命名為 `angleKey`，貼齊 recharts 的 `PolarAngleAxis`，
 * 沿用餅圖 `nameKey` / `valueKey` 立下的「貼齊 recharts prop 命名」慣例。
 */
export const radarChartInputShape = {
  title: z.string().min(1).optional().describe("圖表標題"),
  data: dataSchema,
  angleKey: z
    .string()
    .min(1)
    .describe("作為角度軸（各評比面向）的欄位名稱，須存在於 data 中"),
  series: z
    .array(seriesSchema)
    .min(1)
    .max(MAX_SERIES)
    .describe(`要繪製的數列，1~${MAX_SERIES} 組`),
};

/** strict：誤把笛卡兒圖的 xKey 或餅圖的 nameKey 傳進來時直接被驗證擋下。 */
export const radarChartInputSchema = z.strictObject(radarChartInputShape);

/**
 * 散佈圖的輸入欄位：兩個數值變數的分布，外加選填的第三個維度（氣泡大小）。
 *
 * 共用「數列」與「資料」兩個常數，但**不**沿用 `cartesianCommonShape`——
 * 後者的 `xKey` 語意是「字串類別軸」，散佈圖的 X 軸是連續數值軸。
 *
 * 資料形狀沿用既有的「單一物件陣列」：recharts 另有「每組數列自帶資料」的餵法，
 * 刻意不採用——那需要資料結構變成巢狀陣列，對既有的上限、擷取邏輯、配色推導
 * 全是破壞性改動。共享頂層資料換得的好處是資料結構與其他圖表一致。
 */
export const scatterChartInputShape = {
  title: z.string().min(1).optional().describe("圖表標題"),
  data: dataSchema,
  xKey: z
    .string()
    .min(1)
    .describe("作為 X 軸（連續數值軸）的欄位名稱，須存在於 data 中且各列皆為數值"),
  series: z
    .array(seriesSchema)
    .min(1)
    .max(MAX_SERIES)
    .describe(`要繪製的數列，其 key 為 Y 軸數值欄位，1~${MAX_SERIES} 組`),
  /**
   * 三個維度各自的單位；接在該軸的刻度後面（如 `45元`、`1.2M件`）。
   *
   * 散佈圖的兩個軸都是裸數字，刻度本身讀不出「這是什麼」。單位接在刻度上
   * 同時解決「這是什麼」與「數量級多大」兩件事——比照 recharts 官方
   * SimpleScatterChart 的 `unit`。
   *
   * Y 軸單位採**頂層 `yUnit`** 而非 `series[].unit`：Y 軸刻度只能顯示一種單位，
   * 掛在數列上會允許「多數列各自宣稱不同單位」這種畫不出來的組合。
   *
   * 三者皆選填，未提供時該軸刻度維持純數字。詳見 docs/adr/0006。
   */
  xUnit: z.string().min(1).optional().describe("X 軸的單位，接在刻度數值後（如「元」）"),
  yUnit: z.string().min(1).optional().describe("Y 軸的單位，接在刻度數值後（如「千件」）"),
  /**
   * 兩個軸的標題，畫在該軸旁邊（X 軸在刻度下方，Y 軸旋轉 90° 在刻度左側）。
   *
   * 與 `xUnit` / `yUnit` 是兩件事：單位回答「數量級多大」，標題回答「這個軸是什麼」。
   * 單位接在每個刻度上，無法承載「產品售價」這種完整名稱。
   *
   * 未提供時該軸不畫標題——退回單位加持的裸刻度，即先前的行為。
   */
  xLabel: z.string().min(1).optional().describe("X 軸的標題，畫在刻度下方（如「產品售價」）"),
  yLabel: z
    .string()
    .min(1)
    .optional()
    .describe("Y 軸的標題，旋轉 90° 畫在刻度左側（如「月銷量」）"),
  /**
   * 第三個維度：氣泡大小。散佈圖相對於其他圖表的獨特價值。
   *
   * 選填，未提供時所有點大小相同。值須非負——氣泡大小語意上是「量值」，
   * 負的量值沒有意義；而 recharts 內部會把負值靜默夾成 0，畫出一個看不見的點。
   */
  sizeKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      "作為氣泡大小的欄位，須存在於 data 中且各列皆為非負數值；" +
        "未提供時所有資料點大小相同"
    ),
  /**
   * 氣泡大小這個維度在 Tooltip 上的顯示名稱與單位。
   *
   * 氣泡大小是三個維度中唯一沒有軸刻度可依附的。它曾在圖例區自成一項
   * 「大小：{sizeLabel ?? sizeKey}」（ADR 0006），該項已移除，兩者改由 Tooltip
   * 單獨承載。`sizeLabel` 未提供時回退 `sizeKey`，與 `series[].label` 的既有模式一致。
   *
   * 兩者皆選填，且只在提供 `sizeKey` 時有意義。
   */
  sizeLabel: z
    .string()
    .min(1)
    .optional()
    .describe("氣泡大小在 Tooltip 上的顯示名稱；未提供時使用 sizeKey"),
  sizeUnit: z
    .string()
    .min(1)
    .optional()
    .describe("氣泡大小的單位，顯示於 Tooltip 的氣泡數值後（如「萬元」）"),
};

/** strict：誤把餅圖或雷達圖的欄位傳進來時直接被驗證擋下。 */
export const scatterChartInputSchema = z.strictObject(scatterChartInputShape);

/**
 * 各笛卡兒圖的定義：類別軸 × 多數列，以 `type` 區分。
 *
 * 同輸入端採 strict：tool 產出與前端解析走同一份定義，
 * 兩端對「什麼是合法圖表」的寬嚴也必須一致。
 */
export const lineChartDefinitionSchema = z.strictObject({
  ...lineChartInputShape,
  type: z.literal("line"),
});

export const barChartDefinitionSchema = z.strictObject({
  ...barChartInputShape,
  type: z.literal("bar"),
});

export const areaChartDefinitionSchema = z.strictObject({
  ...areaChartInputShape,
  type: z.literal("area"),
});

/** 笛卡兒圖定義：三個分支的聯集，供前端單一個笛卡兒圖渲染元件取用。 */
export type CartesianChartDefinition =
  | z.infer<typeof lineChartDefinitionSchema>
  | z.infer<typeof barChartDefinitionSchema>
  | z.infer<typeof areaChartDefinitionSchema>;

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
 * 雷達圖定義：極座標上的類別軸 × 多數列。
 *
 * 不併入笛卡兒圖的類型對照表——容器與軸線元件完全不同，塞進去只會讓表上的
 * 「預設是否堆疊」「數列 props」對它說謊。依 ADR 0001：一個 union 分支 + 一個渲染子元件。
 */
export const radarChartDefinitionSchema = z.strictObject({
  ...radarChartInputShape,
  type: z.literal("radar"),
});

export type RadarChartDefinition = z.infer<typeof radarChartDefinitionSchema>;

/**
 * 散佈圖定義：連續數值 X 軸 × 多數列，外加選填的氣泡大小維度。
 *
 * 不進笛卡兒圖的類型對照表——沒有堆疊概念且軸型別不同。
 * 依 ADR 0001：一個 union 分支 + 一個渲染子元件。
 */
export const scatterChartDefinitionSchema = z.strictObject({
  ...scatterChartInputShape,
  type: z.literal("scatter"),
});

export type ScatterChartDefinition = z.infer<typeof scatterChartDefinitionSchema>;

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
  lineChartDefinitionSchema,
  barChartDefinitionSchema,
  areaChartDefinitionSchema,
  pieChartDefinitionSchema,
  radarChartDefinitionSchema,
  scatterChartDefinitionSchema,
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

/** 圖表定義 JSON 化後包成成功的 tool result。 */
function toolSuccess(definition: ChartDefinition): ChartToolResult {
  return { content: [{ type: "text", text: JSON.stringify(definition) }] };
}

/**
 * 「類別軸欄位 + series[].key」共通的欄位存在性比對：兩者都必須對得上 data 的欄位。
 *
 * 這條規則不隨圖表類型而異，故各具名轉換函式共用同一份實作。
 * 直接收下驗證後的輸入物件——這些欄位本來就同進同出，拆成多個參數
 * 只是讓每個呼叫端多寫一次一模一樣的解構。對得上時回傳 null。
 *
 * 類別軸的欄位值由呼叫端傳入，錯誤訊息中的標籤也可指定：笛卡兒圖是 `xKey`（預設），
 * 雷達圖的角度軸是 `angleKey`。兩者的檢查邏輯與錯誤訊息形狀完全相同，差別只在標籤文字。
 * 標籤預設為 `"xKey"`，既有呼叫端的訊息文字因此一字不變。
 */
function findMissingCategoryAndSeriesKeys(
  input: {
    data: Record<string, string | number>[];
    series: { key: string }[];
  },
  categoryKey: string,
  categoryLabel: string = "xKey"
): ChartToolResult | null {
  const { data, series } = input;
  const availableKeys = Object.keys(data[0]);

  const missingCategoryKey = assertKeyExists(categoryLabel, categoryKey, availableKeys);
  if (missingCategoryKey) return missingCategoryKey;

  const missingSeries = series
    .map((s) => s.key)
    .filter((key) => !availableKeys.includes(key));
  if (missingSeries.length > 0) {
    return toolError(
      `series 的欄位 ${missingSeries.map((k) => `"${k}"`).join("、")} 不存在於 data 中；` +
        `可用欄位為：${availableKeys.join("、")}`
    );
  }

  // 同一個欄位被兩組數列共用時，畫出來是幾條完全重疊的線／幾組重疊的點——
  // 後面的蓋住前面的，看起來只有一組，而圖例卻列出好幾個名稱。前端也會撞上
  // React 的重複 key（`key={s.key}`），整張圖直接不渲染。
  //
  // 最常見的來源是「用數列表達分組」的誤解：想比較 B2B／B2C／經銷商，
  // 卻讓三組都指向同一個 avgOrder 欄位。正確的形狀是每組一個欄位，
  // 故錯誤訊息直接把這條路指出來，LLM 才改得動。
  const duplicatedKeys = series
    .map((s) => s.key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicatedKeys.length > 0) {
    const unique = [...new Set(duplicatedKeys)];
    return toolError(
      `series 的欄位 ${unique.map((k) => `"${k}"`).join("、")} 重複；` +
        "每組數列須各自對應 data 中不同的欄位——" +
        "若要比較多個族群，請讓每個族群各有一個欄位（如 b2b、b2c、partner），" +
        "而非多組數列共用同一個欄位"
    );
  }

  return null;
}

/**
 * 驗證折線圖輸入並轉成圖表定義 JSON。
 *
 * 驗證失敗一律回傳 `isError: true` 與具體訊息，讓 LLM 能理解原因並自行重試，
 * 而不是靜默給出空圖表。bar/area 兩個對應函式同此。
 */
export function buildLineChartResult(input: unknown): ChartToolResult {
  const parsed = parseOrError(lineChartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const missingKeys = findMissingCategoryAndSeriesKeys(parsed.value, parsed.value.xKey);
  if (missingKeys) return missingKeys;

  return toolSuccess({ type: "line", ...parsed.value });
}

/** 驗證長條圖輸入並轉成圖表定義 JSON。 */
export function buildBarChartResult(input: unknown): ChartToolResult {
  const parsed = parseOrError(barChartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const missingKeys = findMissingCategoryAndSeriesKeys(parsed.value, parsed.value.xKey);
  if (missingKeys) return missingKeys;

  return toolSuccess({ type: "bar", ...parsed.value });
}

/** 驗證區域圖輸入並轉成圖表定義 JSON。 */
export function buildAreaChartResult(input: unknown): ChartToolResult {
  const parsed = parseOrError(areaChartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const missingKeys = findMissingCategoryAndSeriesKeys(parsed.value, parsed.value.xKey);
  if (missingKeys) return missingKeys;

  return toolSuccess({ type: "area", ...parsed.value });
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

  const { data, nameKey, valueKey, colorKey } = parsed.value;
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

  if (colorKey !== undefined) {
    // nameKey / valueKey 每一列都必須有值，看 data[0] 就夠；colorKey 不同——
    // 缺值的列回退預設配色是刻意支援的，第 1 列剛好沒有色碼欄位是其中最自然的
    // 寫法之一，故存在性改以全列的欄位聯集判定，否則會被誤判為欄位不存在。
    const colorCandidateKeys = [...new Set(data.flatMap((row) => Object.keys(row)))];
    const missingColorKey = assertKeyExists("colorKey", colorKey, colorCandidateKeys);
    if (missingColorKey) return missingColorKey;

    // 色碼格式與數列顏色同一套規則；data 欄位的型別允許任意字串，
    // 故與數值欄位一樣只能在執行期逐列比對。
    for (const [index, row] of data.entries()) {
      const color = row[colorKey];
      // 缺值的列回退預設配色，是刻意允許的混合案例，不視為違規。
      if (color === undefined) continue;
      if (typeof color !== "string" || !HEX_COLOR.test(color)) {
        return toolError(
          `data 第 ${index + 1} 列的 ${colorKey} 值 ${JSON.stringify(color)} 不是 hex 色碼；` +
            "餅圖的顏色欄位每一列都必須是 hex 格式（如 #4f46e5）"
        );
      }
    }
  }

  return toolSuccess({ type: "pie", ...parsed.value });
}

/**
 * 驗證雷達圖輸入並轉成圖表定義 JSON。
 *
 * 欄位存在性沿用與笛卡兒圖同一份檢查，只把標籤換成 `angleKey`——
 * 兩者的規則本來就是同一條，複製一份只會多一處會漂移的訊息文字。
 */
export function buildRadarChartResult(input: unknown): ChartToolResult {
  const parsed = parseOrError(radarChartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const missingKeys = findMissingCategoryAndSeriesKeys(
    parsed.value,
    parsed.value.angleKey,
    "angleKey"
  );
  if (missingKeys) return missingKeys;

  return toolSuccess({ type: "radar", ...parsed.value });
}

/**
 * 驗證散佈圖輸入並轉成圖表定義 JSON。
 *
 * 座標值必須是數值，這只能在執行期逐列比對——data 欄位的型別本來就接受字串。
 * 不擋就是靜默畫出一張空圖，而 LLM 拿不到可自行修正的訊息。
 *
 * 座標**允許負數**：溫差、損益本來就可以是負的。這與餅圖 `valueKey` 的非負
 * 約束不同，因為語意不同——扇形角度不能為負，座標可以。
 */
export function buildScatterChartResult(input: unknown): ChartToolResult {
  const parsed = parseOrError(scatterChartInputSchema, input);
  if (!parsed.ok) return parsed.error;

  const { data, xKey, series, sizeKey, sizeLabel, sizeUnit } = parsed.value;

  const missingKeys = findMissingCategoryAndSeriesKeys(parsed.value, xKey);
  if (missingKeys) return missingKeys;

  // 參數組合的檢查排在逐列掃描之前：兩者都錯時，先回報成本較低的那個，LLM 少一輪往返。
  //
  // sizeLabel / sizeUnit 兩者都只描述「氣泡大小」這個維度，沒有 sizeKey
  // 時就沒有維度可描述。兩條是同一條規則，故走同一張表而非各寫各的 if——
  // 日後再加一個氣泡相關的選填欄位，只需多一列。
  //
  // 明確回報而非靜默忽略：靜默忽略會讓 LLM 以為自己成功調了大小或標了名稱，
  // 它拿不到任何訊號，也就不會重試。
  const bubbleOnlyFields = [
    ["sizeLabel", sizeLabel, "沒有氣泡大小這個維度可標示"],
    ["sizeUnit", sizeUnit, "沒有氣泡大小這個維度可標示"],
  ] as const;

  if (sizeKey === undefined) {
    for (const [field, value, reason] of bubbleOnlyFields) {
      if (value !== undefined) {
        return toolError(`${field} 須與 sizeKey 同時提供；只傳 ${field} 時${reason}`);
      }
    }
  }

  // X 軸與各數列 key 都是數值軸，逐列檢查同一條規則。
  for (const key of [xKey, ...series.map((s) => s.key)]) {
    for (const [index, row] of data.entries()) {
      const value = row[key];
      if (typeof value !== "number" || Number.isNaN(value)) {
        return toolError(
          `data 第 ${index + 1} 列的 ${key} 值 ${JSON.stringify(value)} 不是數值；` +
            "散佈圖的 X 軸與各數列欄位每一列都必須是數值"
        );
      }
    }
  }

  if (sizeKey !== undefined) {
    const missingSizeKey = assertKeyExists("sizeKey", sizeKey, Object.keys(data[0]));
    if (missingSizeKey) return missingSizeKey;

    // 氣泡大小語意上是「量值」，負的量值沒有意義；而 recharts 會把負值
    // 靜默夾成 0，畫出一個看不見的點——這種靜默失敗比畫錯更難察覺。
    // 檢查方式比照餅圖 valueKey：逐列、錯誤訊息帶 1-based 列號。
    for (const [index, row] of data.entries()) {
      const value = row[sizeKey];
      if (typeof value !== "number" || Number.isNaN(value)) {
        return toolError(
          `data 第 ${index + 1} 列的 ${sizeKey} 值 ${JSON.stringify(value)} 不是數值；` +
            "散佈圖的氣泡大小欄位每一列都必須是非負數值"
        );
      }
      if (value < 0) {
        return toolError(
          `data 第 ${index + 1} 列的 ${sizeKey} 值 ${value} 為負數；` +
            "散佈圖的氣泡大小欄位每一列都必須是非負數值"
        );
      }
    }
  }

  return toolSuccess({ type: "scatter", ...parsed.value });
}
