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
 * 兩張圖各自驗一條路徑：
 * - 上：有 sizeKey，單一數列——驗氣泡大小差異與圖例的「大小」項
 * - 下：多數列、無 sizeKey——驗配色與圖例的數列項
 */
import { ChartCard, ChartPaletteProvider } from "@/components/chart-card";
import type { ChartDefinition } from "@/lib/charts/chart-tool";

/**
 * 氣泡路徑：z 值刻意由 100 到 900 跨接近一個數量級，
 * 中段（260、280）與高段（400、500）的差異讀不讀得出來，正是本票要看的。
 */
const STATURE_WEIGHT: ChartDefinition = {
  type: "scatter",
  title: "身高與體重（氣泡大小為樣本數）",
  data: [
    { stature: 100, weight: 200, samples: 200 },
    { stature: 50, weight: 50, samples: 100 },
    { stature: 75, weight: 75, samples: 900 },
    { stature: 120, weight: 100, samples: 260 },
    { stature: 170, weight: 300, samples: 400 },
    { stature: 140, weight: 250, samples: 280 },
    { stature: 150, weight: 400, samples: 500 },
    { stature: 110, weight: 280, samples: 200 },
  ],
  xKey: "stature",
  xLabel: "身高",
  xUnit: "cm",
  yLabel: "體重",
  yUnit: "kg",
  series: [{ key: "weight", label: "A 校" }],
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

export function ScatterChartTpl() {
  return (
    <ChartPaletteProvider charts={[STATURE_WEIGHT, TWO_SCHOOLS]}>
      <div className="flex flex-col gap-4">
        <ChartCard chart={STATURE_WEIGHT} />
        <ChartCard chart={TWO_SCHOOLS} />
      </div>
    </ChartPaletteProvider>
  );
}
