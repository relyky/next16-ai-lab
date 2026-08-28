import { beforeAll, describe, expect, it } from "vitest";
import { render as baseRender, screen } from "@testing-library/react";

import {
  bubbleAreaRange,
  ChartCard,
  ChartPaletteProvider,
  DEFAULT_BUBBLE_RADIUS_RANGE,
  formatAxisTick,
  renderSectorLabel,
  seriesColorAt,
} from "./chart-card";
import type { ChartDefinition } from "@/lib/charts/chart-tool";

/**
 * 圖表卡片的顏色來自 provider 供應的對照表，單獨渲染會讓每個類別都回退到第一色。
 * 此處把被渲染的那張圖自己餵給 provider，色序即該圖內各類別的出現順序——
 * 與導入對照表之前「依 index 循環」的行為一致，既有斷言的意義因此不變。
 */
function render(ui: React.ReactElement) {
  const chart = (ui.props as { chart?: ChartDefinition }).chart;
  return baseRender(
    <ChartPaletteProvider charts={chart ? [chart] : []}>{ui}</ChartPaletteProvider>
  );
}

const singleSeries: ChartDefinition = {
  type: "line",
  title: "月營收趨勢",
  data: [
    { month: "1月", revenue: 120 },
    { month: "2月", revenue: 150 },
  ],
  xKey: "month",
  series: [{ key: "revenue", label: "營收" }],
};

const multiSeries: ChartDefinition = {
  ...singleSeries,
  data: [
    { month: "1月", revenue: 120, cost: 80 },
    { month: "2月", revenue: 150, cost: 90 },
  ],
  series: [
    { key: "revenue", label: "營收" },
    { key: "cost", label: "成本" },
  ],
};

/** recharts 各圖表以 root class 標示自己是哪一種圖，用來判斷渲染的圖表型別。 */
function chartRootClasses(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".recharts-wrapper > svg")).flatMap(
    (svg) => Array.from(svg.classList)
  );
}

// jsdom 的元素一律回報 0x0，ResponsiveContainer 量不到尺寸就不會渲染任何圖形。
// 只覆寫 offsetWidth/offsetHeight（ResponsiveContainer 的量測來源），
// 不動 getBoundingClientRect——那會連刻度文字的尺寸一起弄錯，反而讓版面算不出來。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { value: 800, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { value: 400, configurable: true });
  globalThis.ResizeObserver ??= class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 800, height: 400 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** 三種圖表型別；共用規則的測試對三者一體適用。 */
const CHART_TYPES = [["line"], ["bar"], ["area"]] as const;

describe("ChartCard", () => {
  it.each([
    ["line", "recharts-line"],
    ["bar", "recharts-bar"],
    ["area", "recharts-area"],
  ] as const)("type 為 %s 時渲染對應的 recharts 圖表", (type, seriesClass) => {
    const { container } = render(<ChartCard chart={{ ...singleSeries, type }} />);

    expect(container.querySelector(`.${seriesClass}`)).not.toBeNull();
    expect(chartRootClasses(container)).toContain("recharts-surface");
  });

  it("顯示圖表標題", () => {
    render(<ChartCard chart={singleSeries} />);
    expect(screen.getByText("月營收趨勢")).toBeInTheDocument();
  });

  it("未提供 title 時不渲染標題節點", () => {
    const noTitle: ChartDefinition = { ...singleSeries };
    delete noTitle.title;
    const { container } = render(<ChartCard chart={noTitle} />);

    expect(container.querySelector("[data-slot='chart-title']")).toBeNull();
  });

  it.each(CHART_TYPES)("%s 圖一律渲染 X/Y 軸、格線與 tooltip 容器", (type) => {
    const { container } = render(<ChartCard chart={{ ...singleSeries, type }} />);

    expect(container.querySelector(".recharts-xAxis")).not.toBeNull();
    expect(container.querySelector(".recharts-yAxis")).not.toBeNull();
    expect(container.querySelector(".recharts-cartesian-grid")).not.toBeNull();
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull();
  });

  it.each(CHART_TYPES)("%s 圖單一數列時不渲染 Legend", (type) => {
    const { container } = render(<ChartCard chart={{ ...singleSeries, type }} />);
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
  });

  it.each(CHART_TYPES)("%s 圖多數列時渲染 Legend 並列出各數列 label", (type) => {
    const { container } = render(<ChartCard chart={{ ...multiSeries, type }} />);

    expect(container.querySelector(".recharts-legend-wrapper")).not.toBeNull();
    expect(screen.getByText("營收")).toBeInTheDocument();
    expect(screen.getByText("成本")).toBeInTheDocument();
  });

  // 折線畫在 stroke 上、區域畫在 fill 上；長條的 <path> 由動畫驅動，在 jsdom 下不會生成，
  // 因此改查圖例圖示的 fill——它同樣取自數列顏色，是這裡唯一驗得到的著色點。
  const COLOR_TARGETS = [
    ["line", ".recharts-line-curve", "stroke"],
    ["bar", ".recharts-legend-item path", "fill"],
    ["area", ".recharts-area-area", "fill"],
  ] as const;

  it.each(COLOR_TARGETS)(
    "%s 圖數列顏色套用到實際圖形上（指定色優先，其餘 fallback）",
    (type, selector, attribute) => {
      const { container } = render(
        <ChartCard
          chart={{
            ...multiSeries,
            type,
            series: [{ key: "revenue" }, { key: "cost", color: "#ff0000" }],
          }}
        />
      );

      const colors = Array.from(container.querySelectorAll(selector)).map((el) =>
        el.getAttribute(attribute)
      );
      // 長條圖的圖例順序與數列順序相反，這裡只在意「兩個顏色都正確套用」。
      expect([...colors].sort()).toEqual(["#ff0000", "var(--chart-1)"]);
    }
  );

  it.each([
    ["line", ".recharts-line"],
    ["bar", ".recharts-bar"],
    ["area", ".recharts-area"],
  ] as const)("%s 圖每個數列都各自渲染成一個圖層", (type, seriesClass) => {
    const { container } = render(<ChartCard chart={{ ...multiSeries, type }} />);
    expect(container.querySelectorAll(seriesClass)).toHaveLength(2);
  });

  // 縮寫實際套用到 Y 軸刻度上——真實資料常是千萬級，未縮寫會被裁切成 `000000`。
  it("Y 軸刻度以縮寫單位渲染", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...singleSeries,
          data: [
            { month: "1月", revenue: 1_000_000 },
            { month: "2月", revenue: 4_000_000 },
          ],
        }}
      />
    );

    // 刻度文字為 <text text-anchor="end">，X 軸的則是 "middle"；以此區分兩軸。
    const yTicks = Array.from(
      container.querySelectorAll(".recharts-cartesian-axis-tick-value")
    )
      .filter((el) => el.getAttribute("text-anchor") === "end")
      .map((el) => el.textContent);

    expect(yTicks.length).toBeGreaterThan(0);
    // 未套用縮寫時這裡會是 "1000000"、"4000000"。
    expect(yTicks.some((t) => t?.endsWith("M"))).toBe(true);
    expect(yTicks.every((t) => !/^[0-9]{7,}$/.test(t ?? ""))).toBe(true);
  });

  // 區域圖預設堆疊，各層相鄰；過低的不透明度會讓區塊偏灰、層次不易分辨。
  // 此值取自 recharts 堆疊區域圖範例的預設。
  it("區域圖的填色不透明度為 0.6", () => {
    const { container } = render(<ChartCard chart={{ ...multiSeries, type: "area" }} />);
    const opacities = Array.from(container.querySelectorAll(".recharts-area-area")).map(
      (el) => el.getAttribute("fill-opacity")
    );

    expect(opacities.length).toBeGreaterThan(0);
    expect(opacities.every((o) => o === "0.6")).toBe(true);
  });
});

// recharts 預設只為 Y 軸保留 60px，千萬級的原始數字會溢出 SVG 左緣被裁掉最高位，
// 四個刻度全變成 `000000`。縮寫標籤同時解決寬度與可讀性。
describe("formatAxisTick", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [999, "999"],
    [1000, "1K"],
    [1500, "1.5K"],
    [1_000_000, "1M"],
    [4_000_000, "4M"],
    [12_255_223, "12.3M"],
    [1_000_000_000, "1B"],
  ])("%s → %s", (input, expected) => {
    expect(formatAxisTick(input)).toBe(expected);
  });

  // 千分位以下維持原樣：財務資料的小額數值不該被四捨五入成 1K。
  it("小於 1000 的值不縮寫", () => {
    expect(formatAxisTick(120)).toBe("120");
    expect(formatAxisTick(999.5)).toBe("999.5");
  });

  it("負數同樣縮寫並保留符號", () => {
    expect(formatAxisTick(-4_000_000)).toBe("-4M");
    expect(formatAxisTick(-1500)).toBe("-1.5K");
  });

  it("整數不補上尾隨的 .0", () => {
    expect(formatAxisTick(2_000_000)).toBe("2M");
  });

  it("非有限值原樣回傳，不產生 NaNM 這種標籤", () => {
    expect(formatAxisTick(NaN)).toBe("NaN");
    expect(formatAxisTick(Infinity)).toBe("Infinity");
  });
});

describe("seriesColorAt", () => {
  /** 依序把名稱配到色序 0..n-1，模擬這些名稱依序首次出現的對照表。 */
  const paletteOf = (...names: string[]) =>
    new Map(names.map((name, index) => [name, index]));

  it("series 指定 color 時直接使用該值", () => {
    expect(seriesColorAt({ key: "revenue", color: "#ff0000" }, new Map())).toBe(
      "#ff0000"
    );
  });

  // 色槽數與 MAX_SERIES 對齊，六組數列才不會有兩組撞色。
  it("未指定 color 時依名稱查對照表，取 --chart-1~--chart-6", () => {
    const palette = paletteOf("s0", "s1", "s2", "s3", "s4", "s5");
    const colors = [0, 1, 2, 3, 4, 5].map((i) =>
      seriesColorAt({ key: `s${i}` }, palette)
    );

    expect(colors).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
      "var(--chart-6)",
    ]);
  });

  it("第 7 個名稱才循環回到 --chart-1", () => {
    const palette = paletteOf("s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7");
    expect(seriesColorAt({ key: "s6" }, palette)).toBe("var(--chart-1)");
    expect(seriesColorAt({ key: "s7" }, palette)).toBe("var(--chart-2)");
  });

  // 查表的鍵是 label ?? key——與圖例顯示的文字同一個來源。
  it("有 label 時以 label 查表，而非 key", () => {
    const palette = paletteOf("其他", "營收");
    expect(seriesColorAt({ key: "revenue", label: "營收" }, palette)).toBe(
      "var(--chart-2)"
    );
  });

  // 名稱不在表中時回退索引 0，而不是讓整張圖畫不出來。
  it("名稱不在對照表時回退到 --chart-1", () => {
    expect(seriesColorAt({ key: "unknown" }, paletteOf("其他"))).toBe(
      "var(--chart-1)"
    );
  });
});

const pieChart: ChartDefinition = {
  type: "pie",
  title: "成本結構",
  data: [
    { item: "原料", amount: 120 },
    { item: "人力", amount: 80 },
    { item: "行銷", amount: 40 },
  ],
  nameKey: "item",
  valueKey: "amount",
};

/** 各扇形的實際著色點；餅圖的顏色測試都由此讀取。 */
function sectorFillsOf(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".recharts-pie-sector path.recharts-sector")
  ).map((el) => el.getAttribute("fill"));
}

describe("ChartCard 餅圖", () => {
  it("依資料筆數渲染對應數量的扇形", () => {
    const { container } = render(<ChartCard chart={pieChart} />);
    expect(container.querySelectorAll(".recharts-pie-sector")).toHaveLength(3);
  });

  it("未指定 colorKey 時逐扇形循環套用預設配色", () => {
    const { container } = render(<ChartCard chart={pieChart} />);

    expect(sectorFillsOf(container)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
    ]);
  });

  // 指定色勝出、未指定的列回退預設配色——回退取的是該扇形自己的序號，
  // 而非「第幾個未指定」，兩者在混合案例才分得出來。
  it("指定 colorKey 時該欄位的色碼勝出，缺值的列回退預設配色", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...pieChart,
          data: [
            { item: "原料", amount: 120, tone: "#ff0000" },
            { item: "人力", amount: 80 },
            { item: "行銷", amount: 40, tone: "#00ff00" },
          ],
          colorKey: "tone",
        }}
      />
    );

    expect(sectorFillsOf(container)).toEqual([
      "#ff0000",
      "var(--chart-2)",
      "#00ff00",
    ]);
  });

  // 後端已允許「colorKey 只出現在後續列」，前端必須同樣容得下這種資料，
  // 否則兩端對同一份合法定義的解讀會分歧。
  it("colorKey 指到的欄位在第 1 列缺值時，該扇形回退預設配色", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...pieChart,
          data: [
            { item: "原料", amount: 120 },
            { item: "人力", amount: 80, tone: "#00ff00" },
            { item: "行銷", amount: 40 },
          ],
          colorKey: "tone",
        }}
      />
    );

    expect(sectorFillsOf(container)).toEqual([
      "var(--chart-1)",
      "#00ff00",
      "var(--chart-3)",
    ]);
  });

  // 圖例內容在 jsdom 下需等 recharts 的 payload 就緒，此處只驗容器存在；
  // 「類別名稱看得見」改由扇形標籤驗證——它是同一份 nameKey 的另一個呈現點。
  it("渲染圖例容器", () => {
    const { container } = render(<ChartCard chart={pieChart} />);
    expect(container.querySelector(".recharts-legend-wrapper")).not.toBeNull();
  });

  // 標籤與圖例的文字節點在 jsdom 下不生成；扇形的 name 屬性是 nameKey
  // 唯一驗得到的落點，tooltip 與圖例的類別名稱同樣取自它。
  it("各扇形帶上對應的類別名稱", () => {
    const { container } = render(<ChartCard chart={pieChart} />);
    const names = Array.from(
      container.querySelectorAll(".recharts-pie-sector path.recharts-sector")
    ).map((el) => el.getAttribute("name"));

    expect(names).toEqual(["原料", "人力", "行銷"]);
  });

  it("渲染 tooltip 容器", () => {
    const { container } = render(<ChartCard chart={pieChart} />);
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull();
  });

  // 餅圖的扇形角度即為佔比，軸線與格線在此沒有意義。
  it("不渲染軸線與格線", () => {
    const { container } = render(<ChartCard chart={pieChart} />);

    expect(container.querySelector(".recharts-xAxis")).toBeNull();
    expect(container.querySelector(".recharts-yAxis")).toBeNull();
    expect(container.querySelector(".recharts-cartesian-grid")).toBeNull();
  });

  it("顯示圖表標題", () => {
    render(<ChartCard chart={pieChart} />);
    expect(screen.getByText("成本結構")).toBeInTheDocument();
  });
});

// 標籤文字的 SVG 節點在 jsdom 下不生成，故直接驗產生文字的純函式。
describe("renderSectorLabel", () => {
  it("標出類別名稱與佔比百分比", () => {
    expect(renderSectorLabel({ name: "原料", percent: 0.5 })).toBe("原料 50.0%");
  });

  // 整數會讓 33.3% 與 33.4% 併成同一個數字，看起來像資料有誤。
  it("百分比取一位小數", () => {
    expect(renderSectorLabel({ name: "人力", percent: 1 / 3 })).toBe("人力 33.3%");
  });

  // 標籤字寬固定，過窄的扇形標上去只會互相疊住。
  it("佔比過小的扇形不標", () => {
    expect(renderSectorLabel({ name: "雜項", percent: 0.02 })).toBeNull();
  });

  it("佔比達門檻的扇形照標", () => {
    expect(renderSectorLabel({ name: "雜項", percent: 0.03 })).toBe("雜項 3.0%");
  });

  // recharts 未帶 percent 時不該畫出 "undefined%"。
  it("沒有 percent 時不標", () => {
    expect(renderSectorLabel({ name: "原料" })).toBeNull();
  });
});

const radarChart: ChartDefinition = {
  type: "radar",
  title: "分店評比",
  data: [
    { aspect: "服務", 北店: 80, 南店: 65 },
    { aspect: "價格", 北店: 60, 南店: 90 },
    { aspect: "品質", 北店: 75, 南店: 70 },
  ],
  angleKey: "aspect",
  series: [
    { key: "北店", label: "北店" },
    { key: "南店", label: "南店" },
  ],
};

const singleSeriesRadar: ChartDefinition = {
  ...radarChart,
  series: [{ key: "北店", label: "北店" }],
};

describe("ChartCard 雷達圖", () => {
  it("渲染雷達區域、極座標網格與角度軸", () => {
    const { container } = render(<ChartCard chart={radarChart} />);

    expect(container.querySelector(".recharts-radar")).not.toBeNull();
    expect(container.querySelector(".recharts-polar-grid")).not.toBeNull();
    expect(container.querySelector(".recharts-polar-angle-axis")).not.toBeNull();
  });

  it("多組數列各自渲染成一塊區域", () => {
    const { container } = render(<ChartCard chart={radarChart} />);
    expect(container.querySelectorAll(".recharts-radar")).toHaveLength(2);
  });

  // 角度軸的刻度文字是 angleKey 在畫面上唯一驗得到的落點。
  it("角度軸標出各評比面向的名稱", () => {
    const { container } = render(<ChartCard chart={radarChart} />);
    const labels = Array.from(
      container.querySelectorAll(".recharts-polar-angle-axis-tick-value")
    ).map((el) => el.textContent);

    expect(labels).toEqual(["服務", "價格", "品質"]);
  });

  /**
   * 半徑軸不標刻度數字：雷達圖的讀法是形狀輪廓比較而非讀絕對值，
   * 數字疊在網格上可讀性差；實際數值仍可由 tooltip 取得。
   */
  it("半徑軸不渲染刻度數字", () => {
    const { container } = render(<ChartCard chart={radarChart} />);
    expect(
      container.querySelectorAll(".recharts-polar-radius-axis-tick-value")
    ).toHaveLength(0);
  });

  it("多數列時渲染 Legend 並列出各數列 label", () => {
    const { container } = render(<ChartCard chart={radarChart} />);

    expect(container.querySelector(".recharts-legend-wrapper")).not.toBeNull();
    expect(screen.getByText("北店")).toBeInTheDocument();
    expect(screen.getByText("南店")).toBeInTheDocument();
  });

  it("單一數列時不渲染 Legend", () => {
    const { container } = render(<ChartCard chart={singleSeriesRadar} />);
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
  });

  it("數列顏色套用到區域上（指定色優先，其餘 fallback）", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...radarChart,
          series: [{ key: "北店" }, { key: "南店", color: "#ff0000" }],
        }}
      />
    );

    // `.recharts-radar-polygon` 是外層 <g>；實際著色的是它內部的 <path>。
    const fills = Array.from(
      container.querySelectorAll(".recharts-radar-polygon path.recharts-polygon")
    ).map((el) => el.getAttribute("fill"));
    expect([...fills].sort()).toEqual(["#ff0000", "var(--chart-1)"]);
  });

  it("渲染 tooltip 容器", () => {
    const { container } = render(<ChartCard chart={radarChart} />);
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull();
  });

  // 雷達圖是極座標，笛卡兒的軸線與格線在此沒有意義。
  it("不渲染笛卡兒軸線與格線", () => {
    const { container } = render(<ChartCard chart={radarChart} />);

    expect(container.querySelector(".recharts-cartesian-grid")).toBeNull();
    expect(container.querySelector(".recharts-xAxis")).toBeNull();
    expect(container.querySelector(".recharts-yAxis")).toBeNull();
  });

  it("顯示圖表標題", () => {
    render(<ChartCard chart={radarChart} />);
    expect(screen.getByText("分店評比")).toBeInTheDocument();
  });
});

const scatterChart: ChartDefinition = {
  type: "scatter",
  title: "價格與銷量",
  data: [
    { price: 10, sales: 4_000_000, profit: 5 },
    { price: 20, sales: 2_000_000, profit: 50 },
    { price: 30, sales: 6_000_000, profit: 100 },
  ],
  xKey: "price",
  series: [{ key: "sales", label: "銷量" }],
};

const multiSeriesScatter: ChartDefinition = {
  ...scatterChart,
  data: [
    { price: 10, sales: 400, cost: 120 },
    { price: 20, sales: 250, cost: 90 },
  ],
  series: [
    { key: "sales", label: "銷量" },
    { key: "cost", label: "成本" },
  ],
};

/** 各資料點的實際著色與幾何都掛在 symbol path 上。 */
function scatterSymbolsOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll("path.recharts-symbols"));
}

/** symbol 的寬度即該氣泡的直徑；jsdom 下 recharts 仍會算出這個屬性。 */
function bubbleWidthsOf(container: HTMLElement) {
  return scatterSymbolsOf(container).map((el) => Number(el.getAttribute("width")));
}

describe("ChartCard 散佈圖", () => {
  it("依資料筆數渲染對應數量的資料點", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    expect(scatterSymbolsOf(container)).toHaveLength(3);
  });

  /**
   * X 軸為連續數值軸而非等距類別軸：刻度不會是 data 裡的三個原始值，
   * 而是由值域推導出的等距刻度。這是散佈圖與笛卡兒圖最關鍵的差異。
   */
  it("X 軸為連續數值軸而非等距類別軸", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    const xTicks = Array.from(
      container.querySelectorAll(".recharts-cartesian-axis-tick-value")
    )
      .filter((el) => el.getAttribute("text-anchor") === "middle")
      .map((el) => el.textContent);

    // 類別軸會原樣列出 10 / 20 / 30 三個值；數值軸則從 0 起算等距刻度。
    expect(xTicks).not.toEqual(["10", "20", "30"]);
    expect(xTicks[0]).toBe("0");
  });

  // 兩個軸都是數值軸，都套用大數值縮寫。
  it("兩個座標軸都套用大數值縮寫", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...scatterChart,
          data: [
            { price: 1_000_000, sales: 4_000_000 },
            { price: 4_000_000, sales: 6_000_000 },
          ],
        }}
      />
    );
    const ticks = Array.from(
      container.querySelectorAll(".recharts-cartesian-axis-tick-value")
    );
    const xTicks = ticks
      .filter((el) => el.getAttribute("text-anchor") === "middle")
      .map((el) => el.textContent);
    const yTicks = ticks
      .filter((el) => el.getAttribute("text-anchor") === "end")
      .map((el) => el.textContent);

    expect(xTicks.some((t) => t?.endsWith("M"))).toBe(true);
    expect(yTicks.some((t) => t?.endsWith("M"))).toBe(true);
  });

  it("多組數列各自套用不同顏色", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...multiSeriesScatter,
          series: [{ key: "sales" }, { key: "cost", color: "#ff0000" }],
        }}
      />
    );
    const fills = new Set(
      scatterSymbolsOf(container).map((el) => el.getAttribute("fill"))
    );

    expect([...fills].sort()).toEqual(["#ff0000", "var(--chart-1)"]);
  });

  it("單一數列時不渲染 Legend", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
  });

  it("多數列時渲染 Legend 並列出各數列 label", () => {
    const { container } = render(<ChartCard chart={multiSeriesScatter} />);

    expect(container.querySelector(".recharts-legend-wrapper")).not.toBeNull();
    expect(screen.getByText("銷量")).toBeInTheDocument();
    expect(screen.getByText("成本")).toBeInTheDocument();
  });

  it("渲染格線與 tooltip 容器", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);

    expect(container.querySelector(".recharts-cartesian-grid")).not.toBeNull();
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull();
  });

  it("顯示圖表標題", () => {
    render(<ChartCard chart={scatterChart} />);
    expect(screen.getByText("價格與銷量")).toBeInTheDocument();
  });

  // 未提供 sizeKey 時所有點大小相同——這是「沒有第三個維度」的視覺表達。
  it("未提供 sizeKey 時所有資料點大小相同", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    const widths = bubbleWidthsOf(container);

    expect(widths.length).toBe(3);
    expect(new Set(widths).size).toBe(1);
  });

  it("提供 sizeKey 時氣泡大小有可見差異", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, sizeKey: "profit" }} />
    );
    const widths = bubbleWidthsOf(container);

    expect(widths.length).toBe(3);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  /**
   * 契約的單位是半徑：range 的最大半徑須真的等於畫出來的最大氣泡半徑，
   * 否則半徑→面積的換算就接錯了。symbol 的 width 即直徑。
   */
  it("最大氣泡的半徑等於 range 的最大值，不溢出繪圖區", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, sizeKey: "profit", range: [4, 20] }} />
    );
    const maxRadius = Math.max(...bubbleWidthsOf(container)) / 2;

    expect(maxRadius).toBeCloseTo(20);
  });

  it("未提供 range 時套用預設的最大半徑 12", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, sizeKey: "profit" }} />
    );
    const maxRadius = Math.max(...bubbleWidthsOf(container)) / 2;

    expect(maxRadius).toBeCloseTo(DEFAULT_BUBBLE_RADIUS_RANGE[1]);
  });
});

/**
 * 半徑→面積的換算單獨測試：jsdom 不產生 SVG 幾何，此換算在渲染斷言中驗不到。
 * 平方與圓周率是兩個易錯點——寫成 `2 * π * r` 或漏掉平方都會過不了。
 */
describe("bubbleAreaRange", () => {
  it("依 πr² 換算自訂的半徑範圍", () => {
    expect(bubbleAreaRange([4, 20])).toEqual([Math.PI * 16, Math.PI * 400]);
  });

  it("未提供時套用預設的 [4, 12]", () => {
    expect(bubbleAreaRange()).toEqual([Math.PI * 16, Math.PI * 144]);
    expect(bubbleAreaRange()).toEqual(bubbleAreaRange(DEFAULT_BUBBLE_RADIUS_RANGE));
  });

  // 面積與半徑是平方關係：半徑翻倍，面積變四倍。寫成線性換算會過不了。
  it("半徑翻倍時面積變為四倍", () => {
    const [, small] = bubbleAreaRange([1, 5]);
    const [, large] = bubbleAreaRange([1, 10]);

    expect(large / small).toBeCloseTo(4);
  });

  // 具體數值：ADR 中舉的 [64, 400] 面積對應約 4.5px 到 11.3px 半徑，
  // 反向驗證換算方向沒有寫反。
  it("半徑 4.5 與 11.3 換算出的面積約為 64 與 400", () => {
    const [min, max] = bubbleAreaRange([4.5, 11.3]);

    // ADR 中的 4.5 / 11.3 本身是四捨五入後的半徑，故取整數位級距的容差。
    expect(min).toBeCloseTo(64, -1);
    expect(max).toBeCloseTo(400, -1);
  });
});
