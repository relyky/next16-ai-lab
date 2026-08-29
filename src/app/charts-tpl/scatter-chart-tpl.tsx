"use client";

/**
 * 散佈圖樣板：驗證正式元件 `ChartCard` 的散佈圖在真實瀏覽器裡的結果。
 *
 * 本樣板原本渲染的是裸 recharts 元件，用來試 recharts 3.x 的三個新寫法
 * （`responsive`、`YAxis width="auto"`、`Legend position`）。三項實驗都已收編進
 * `chart-card.tsx`，樣板的任務因此改變：從「試新 API」變成「驗證正式元件」。
 *
 * jsdom 驗不到版面重疊，只有瀏覽器看得出來的三件事在這裡複核（issue #73）：
 * - `insideTopLeft` 的圖例是否遮住左上角的資料點
 * - 氣泡大小差異是否可辨識——改用 `ZAxis.range` 後中段氣泡會擠在高值區，
 *   見 docs/adr/0005 的「後續修正」一節
 * - 軸標題與刻度、圖例是否互相重疊
 *
 * **必須包在 `ChartPaletteProvider` 裡**：少了它 `useChartPalette()` 回傳空 Map，
 * 每個數列都回退第一個顏色，畫出來會是同色的點——看起來很像著色壞掉，
 * 其實是這層漏掉了。與 `pie-chart-tpl.tsx` 同一個陷阱。
 *
 * 兩張圖各自驗一條路徑，皆為多數列：
 * - 上：有 sizeKey——驗氣泡大小差異，以及配色與大小是兩個獨立維度
 * - 下：無 sizeKey——驗所有點大小一致時的配色與圖例
 */
import { CHART_KIND_LABEL, ChartCard, ChartPaletteProvider } from "@/components/chart-card";
import type { ChartDefinition } from "@/lib/charts/chart-tool";

/**
 * 氣泡路徑：z 值刻意由 100 到 900 跨接近一個數量級，
 * 中段（260、280）與高段（400、500）的差異讀不讀得出來，正是本票要看的。
 *
 * 兩個數列同時走氣泡路徑，驗的是「配色與大小是兩個獨立維度」——同一個 x 上
 * 兩校的點取不同顏色，但**共用同一個 `samples` 值**因而大小相同。
 * `sizeKey` 指的是 data 的單一欄位，不隨數列而異：這是契約本來的形狀，
 * 畫出來看得到才不會誤以為每個數列可以各有各的大小來源。
 */
const STATURE_WEIGHT: ChartDefinition = {
  type: "scatter",
  title: "身高與體重（兩校，氣泡大小為樣本數）",
  data: [
    { stature: 100, weightA: 200, weightB: 150, samples: 200 },
    { stature: 50, weightA: 50, weightB: 90, samples: 100 },
    { stature: 75, weightA: 75, weightB: 180, samples: 900 },
    { stature: 120, weightA: 100, weightB: 220, samples: 260 },
    { stature: 170, weightA: 300, weightB: 210, samples: 400 },
    { stature: 140, weightA: 250, weightB: 130, samples: 280 },
    { stature: 150, weightA: 400, weightB: 330, samples: 500 },
    { stature: 110, weightA: 280, weightB: 350, samples: 200 },
  ],
  xKey: "stature",
  xLabel: "身高",
  xUnit: "cm",
  yLabel: "體重",
  yUnit: "kg",
  series: [
    { key: "weightA", label: "A 校" },
    { key: "weightB", label: "B 校" },
  ],
  sizeKey: "samples",
  sizeLabel: "樣本數",
  sizeUnit: "人",
};

// 多數列路徑：兩個數列各自取一色，圖例列出兩項——沒有 sizeKey，
// 故圖例不應出現「大小」那一項。左上角的點刻意密集，用來看圖例是否遮擋。
const TWO_SCHOOLS: ChartDefinition = {
  type: "scatter",
  title: "兩校身高與體重（多數列配色）",
  data: [
    { stature: 50, a: 50, b: 60 },
    { stature: 75, a: 75, b: 200 },
    { stature: 100, a: 200, b: 150 },
    { stature: 150, a: 400, b: 150 },
    { stature: 200, a: 280, b: 75 },
  ],
  xKey: "stature",
  xLabel: "身高",
  xUnit: "cm",
  yLabel: "體重",
  yUnit: "kg",
  series: [
    { key: "a", label: "A 校" },
    { key: "b", label: "B 校" },
  ],
};

/**
 * 分群比較：三個客戶族群各佔一個欄位，共用同一條 X 軸。
 *
 * 這是散佈圖最常見的用途，也是最容易把契約用錯的地方——想比較三個族群時，
 * 直覺會寫成「三組數列都指向 avgOrder」，那會畫出三組完全重疊的點，
 * 且前端撞上 React 的重複 key。正確形狀是**每個族群一個欄位**，
 * tool 端已擋下錯誤形狀（見 `findMissingCategoryAndSeriesKeys`）。
 */
const CUSTOMER_SEGMENTS: ChartDefinition = {
  type: "scatter",
  title: "客戶族群行為比較",
  data: [
    // B2B：低頻高單價，聚在左上
    { freq: 4, b2b: 82000, b2c: 620, partner: 24000 },
    { freq: 6, b2b: 76000, b2c: 480, partner: 31000 },
    { freq: 8, b2b: 91000, b2c: 540, partner: 27000 },
    { freq: 11, b2b: 68000, b2c: 710, partner: 33000 },
    // B2C：高頻低單價，聚在右下
    { freq: 18, b2b: 58000, b2c: 890, partner: 29000 },
    { freq: 24, b2b: 61000, b2c: 760, partner: 35000 },
    { freq: 31, b2b: 54000, b2c: 950, partner: 26000 },
    { freq: 42, b2b: 49000, b2c: 1120, partner: 38000 },
    // 離群點：某 B2B 客戶頻率異常高、單價驟降——正是要跟進的警訊
    { freq: 56, b2b: 12000, b2c: 1040, partner: 41000 },
  ],
  xKey: "freq",
  xLabel: "近一年下單頻率",
  xUnit: "次",
  yLabel: "平均客單價",
  yUnit: "元",
  series: [
    { key: "b2b", label: "B2B 企業客戶" },
    { key: "b2c", label: "B2C 一般消費者" },
    { key: "partner", label: "經銷商 partner" },
  ],
};

export function ScatterChartTpl() {
  return (
    <ChartPaletteProvider charts={[STATURE_WEIGHT, TWO_SCHOOLS, CUSTOMER_SEGMENTS]}>
      <div className="flex flex-col gap-4">
        {/* 圖種標在卡片外：樣板頁用它區隔各段，卡片本身不帶這個標示。 */}
        <h3 className="text-base font-semibold">
          {CHART_KIND_LABEL[STATURE_WEIGHT.type]}
        </h3>
        <ChartCard chart={STATURE_WEIGHT} />
        <ChartCard chart={TWO_SCHOOLS} />
        <ChartCard chart={CUSTOMER_SEGMENTS} />
      </div>
    </ChartPaletteProvider>
  );
}
