"use client";

/**
 * 餅圖樣板：驗證 `Pie` 的 `shape` prop 取代已棄用 `Cell` 之後的著色行為。
 *
 * 與散佈圖樣板不同，這裡渲染的是 `ChartCard` 本身而非裸 recharts 元件——
 * 要驗的正是 chart-card 的逐扇形著色在真實瀏覽器裡的結果。
 * jsdom 測試驗得到 `fill` 的字串值，但 `var(--chart-N)` 要到瀏覽器才解析成
 * 實際顏色，「四個扇形是否真的四色分明」只有在這裡看得出來。
 *
 * 兩張圖各自驗一條路徑：
 * - 上：未指定 colorKey，逐扇形依類別名稱查對照表
 * - 下：指定 colorKey，有色碼的列勝出、缺值的列回退對照表
 *
 * **必須包在 `ChartPaletteProvider` 裡**：少了它 `useChartPalette()` 回傳空 Map，
 * 每個類別都回退第一個顏色，畫出來會是四個同色扇形——看起來很像著色壞掉，
 * 其實是這層漏掉了。
 */
import { CHART_KIND_LABEL, ChartCard, ChartPaletteProvider } from "@/components/chart-card";
import type { ChartDefinition } from "@/lib/charts/chart-tool";

const COST_BREAKDOWN: ChartDefinition = {
  type: "pie",
  title: "成本結構（預設配色）",
  data: [
    { item: "原料", amount: 120 },
    { item: "人力", amount: 80 },
    { item: "行銷", amount: 40 },
    { item: "其他", amount: 15 },
  ],
  nameKey: "item",
  valueKey: "amount",
};

// 刻意讓中間那列缺 tone：回退取的是該扇形自己的類別名稱，
// 而非「第幾個未指定」——混合案例才分得出這兩者。
const COST_BREAKDOWN_TONED: ChartDefinition = {
  type: "pie",
  title: "成本結構（指定色與回退混合）",
  data: [
    { item: "原料", amount: 120, tone: "#ff0000" },
    { item: "人力", amount: 80 },
    { item: "行銷", amount: 40, tone: "#00aa00" },
  ],
  nameKey: "item",
  valueKey: "amount",
  colorKey: "tone",
};

export function PieChartTpl() {
  return (
    <ChartPaletteProvider charts={[COST_BREAKDOWN, COST_BREAKDOWN_TONED]}>
      <div className="flex flex-col gap-4">
        {/* 圖種標在卡片外：樣板頁用它區隔各段，卡片本身不帶這個標示。 */}
        <h3 className="text-base font-semibold">
          {CHART_KIND_LABEL[COST_BREAKDOWN.type]}
        </h3>
        <ChartCard chart={COST_BREAKDOWN} />
        <ChartCard chart={COST_BREAKDOWN_TONED} />
      </div>
    </ChartPaletteProvider>
  );
}
