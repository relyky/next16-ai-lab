import { describe, expect, it } from "vitest";

import { buildChartPalette, paletteColorFor } from "./chart-palette";
import type { ChartDefinition } from "./chart-tool";

const lineChart: ChartDefinition = {
  type: "line",
  data: [
    { month: "1月", sales: 300, mfg: 150 },
    { month: "2月", sales: 320, mfg: 160 },
  ],
  xKey: "month",
  series: [
    { key: "sales", label: "銷售部" },
    { key: "mfg", label: "製造部" },
  ],
};

const pieChart: ChartDefinition = {
  type: "pie",
  data: [
    { dept: "製造部", amount: 310 },
    { dept: "銷售部", amount: 620 },
  ],
  nameKey: "dept",
  valueKey: "amount",
};

/** 取某個名稱在對照表中對應到的顏色，測試中反覆用到。 */
const colorOf = (charts: ChartDefinition[], name: string) =>
  paletteColorFor(buildChartPalette(charts), name);

describe("buildChartPalette", () => {
  // 本次變更的核心：同一個部門在折線圖與餅圖裡必須是同一個顏色。
  it("同一個類別名稱跨圖表拿到同一個顏色", () => {
    const charts = [lineChart, pieChart];

    expect(colorOf(charts, "銷售部")).toBe("var(--chart-1)");
    expect(colorOf(charts, "製造部")).toBe("var(--chart-2)");
  });

  // 餅圖裡「製造部」排在「銷售部」之前，但色序由折線圖的首次出現決定。
  it("色序依首次出現順序，不受後續圖表的排列影響", () => {
    const palette = buildChartPalette([lineChart, pieChart]);

    expect(palette.get("銷售部")).toBe(0);
    expect(palette.get("製造部")).toBe(1);
  });

  it("圖表順序對調時色序跟著對調", () => {
    const palette = buildChartPalette([pieChart, lineChart]);

    expect(palette.get("製造部")).toBe(0);
    expect(palette.get("銷售部")).toBe(1);
  });

  it("笛卡兒圖以 label 為鍵，未提供 label 時才用 key", () => {
    const palette = buildChartPalette([
      {
        ...lineChart,
        series: [{ key: "sales", label: "銷售部" }, { key: "mfg" }],
      },
    ]);

    expect(palette.has("銷售部")).toBe(true);
    expect(palette.has("mfg")).toBe(true);
    // label 存在時 key 不該進表，否則同一組數列會佔掉兩個色序。
    expect(palette.has("sales")).toBe(false);
  });

  // 類別名稱允許是數字（如以年份分類），Map 的鍵統一轉字串才查得到。
  it("餅圖的數字類別名稱轉成字串當鍵", () => {
    const palette = buildChartPalette([
      {
        ...pieChart,
        data: [
          { dept: 2024, amount: 100 },
          { dept: 2025, amount: 120 },
        ],
      },
    ]);

    expect(palette.get("2024")).toBe(0);
    expect(palette.get("2025")).toBe(1);
  });

  it("空清單得到空對照表", () => {
    expect(buildChartPalette([]).size).toBe(0);
  });
});

describe("paletteColorFor", () => {
  // 色槽數與 MAX_SERIES 對齊；第 7 個類別才開始撞色。
  it("第 7 個類別循環回到 --chart-1", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const palette = new Map(names.map((name, index) => [name, index]));

    expect(paletteColorFor(palette, "f")).toBe("var(--chart-6)");
    expect(paletteColorFor(palette, "g")).toBe("var(--chart-1)");
    expect(paletteColorFor(palette, "h")).toBe("var(--chart-2)");
  });

  // 配色是呈現層細節，查不到不該讓一張畫得出來的圖整個不顯示。
  it("名稱不在對照表時回退到第一個顏色", () => {
    expect(paletteColorFor(new Map(), "沒見過")).toBe("var(--chart-1)");
  });
});
