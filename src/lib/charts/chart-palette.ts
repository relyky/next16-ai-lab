/**
 * 圖表配色的分配規則：同一份數據延用同一顏色。
 *
 * 「同一份數據」以**類別名稱**判定——折線／長條／區域圖是各數列的顯示名稱
 * （`label ?? key`），餅圖是 `nameKey` 指到的值。同名即同色，因此「銷售部」
 * 在折線圖與餅圖裡是同一個顏色，讀者不必在兩張圖之間重新對照圖例。
 *
 * 色序依**首次出現順序**分配：對照表由目前的圖表清單推導，而非邊 render 邊寫入
 * 一個累積的 Map。純函式沒有 side effect，React StrictMode 的 double-invoke
 * 不會把色序配掉兩倍，串流過程中重複 render 也永遠得到同一份對照表。
 */
import type { ChartDefinition } from "./chart-tool";

/** 預設配色，沿用專案既有的 shadcn 圖表 CSS 變數。 */
export const FALLBACK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/** 名稱 → 色序的對照表；值為 FALLBACK_COLORS 的索引。 */
export type ChartPalette = ReadonlyMap<string, number>;

/**
 * 單一圖表裡各類別的名稱，依其在圖表中的出現順序。
 *
 * 兩種圖表的「類別」住在不同層級——笛卡兒圖是數列（一列多筆數值），
 * 餅圖是資料列（一列一個扇形）——故取名稱的方式必須分開。
 */
function categoryNamesOf(chart: ChartDefinition): string[] {
  if (chart.type === "pie") {
    // 扇形名稱來自資料列，型別允許數字（如以年份為類別），統一轉字串當鍵。
    return chart.data.map((row) => String(row[chart.nameKey]));
  }
  // 與圖例、tooltip 顯示的文字同一個來源，對照表的鍵才與讀者看到的名稱一致。
  return chart.series.map((s) => s.label ?? s.key);
}

/**
 * 由圖表清單推導名稱 → 色序對照表。
 *
 * 傳入的順序即「首次出現順序」，故呼叫端須依訊息與圖表的實際產生順序攤平後傳入。
 */
export function buildChartPalette(charts: readonly ChartDefinition[]): ChartPalette {
  const palette = new Map<string, number>();
  for (const chart of charts) {
    for (const name of categoryNamesOf(chart)) {
      // 已見過的名稱保留首次拿到的色序，後續圖表才會延用同一顏色。
      if (!palette.has(name)) palette.set(name, palette.size);
    }
  }
  return palette;
}

/**
 * 依名稱取預設顏色。
 *
 * 名稱不在對照表時（例如單獨渲染一張圖、未經 provider）回退到 0，
 * 而不是拋錯——配色是呈現層的細節，不該讓一張畫得出來的圖整個不顯示。
 */
export function paletteColorFor(palette: ChartPalette, name: string): string {
  const index = palette.get(name) ?? 0;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}
