import { beforeAll, describe, expect, it } from "vitest";
import { render as baseRender, screen } from "@testing-library/react";

import {
  axisLabel,
  CHART_KIND_LABEL,
  bubbleAxisLabels,
  ChartCard,
  ChartPaletteProvider,
  formatAxisTick,
  renderSectorLabel,
  seriesColorAt,
} from "./chart-card";
import type { ChartDefinition, ScatterChartDefinition } from "@/lib/charts/chart-tool";

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

// jsdom 的元素一律回報 0x0，recharts 量不到尺寸就不會渲染任何圖形。
//
// `responsive` prop 的量測來源與遷移前的 `ResponsiveContainer` 不同：它讀的是
// **包裹 div 的 `getBoundingClientRect()`**，再由 ResizeObserver 的 `contentRect`
// 持續更新（見 recharts 的 `RechartsWrapper.js`），而不是 offsetWidth/offsetHeight。
//
// 「不動 getBoundingClientRect，那會連刻度文字的尺寸一起弄錯」這個判斷仍然成立，
// 故這裡**只對 recharts 的包裹 div** 回報尺寸，其餘元素一律走原本的實作——
// recharts 量刻度文字用的是掛在 body 上的一個隱藏 span（`DOMUtils.js` 的
// measureTextWithDOM），整片覆寫會把它一起弄成 800×400，版面就算不出來了。
//
// ResizeObserver 假件仍需存在：recharts 只在它有定義時才進入量測分支。
beforeAll(() => {
  const originalGetRect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      if (!this.classList.contains("recharts-wrapper")) {
        return originalGetRect.call(this);
      }
      return { ...originalGetRect.call(this), width: 800, height: 400 } as DOMRect;
    },
  });

  globalThis.ResizeObserver = class {
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

/**
 * 各資料點的實際著色與幾何都掛在 symbol path 上。
 *
 * 限縮在 `.recharts-scatter-symbol` 之下：圖例的圓形圖示也是 `path.recharts-symbols`，
 * 不限縮會把它一併算成資料點。
 */
function scatterSymbolsOf(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".recharts-scatter-symbol path.recharts-symbols")
  );
}

/** symbol 的寬度即該氣泡的直徑；jsdom 下 recharts 仍會算出這個屬性。 */
function bubbleWidthsOf(container: HTMLElement) {
  return scatterSymbolsOf(container).map((el) => Number(el.getAttribute("width")));
}

/**
 * 軸的 `name` 掛在該軸渲染出的線段元素上，是 Tooltip 取用名稱的來源。
 * 散佈圖的軸是純數值，刻度不說明畫的是什麼，名稱即這個維度唯一的標示。
 */
function axisNameOf(container: HTMLElement, axis: "xAxis" | "yAxis") {
  return container
    .querySelector(`.recharts-${axis} .recharts-cartesian-axis-line`)
    ?.getAttribute("name");
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

  /**
   * 散佈圖一律顯示圖例，單一數列也不例外——這是它與折線／長條／區域／雷達圖
   * 的刻意分歧。後者的 X 軸把類別名稱寫在刻度上，Y 軸語意由該脈絡撐住；
   * 散佈圖兩軸都是裸數字，沒有脈絡可倚靠，單一數列正是最需要圖例的情境。
   */
  it("單一數列時仍渲染 Legend 並列出該數列 label", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);

    expect(container.querySelector(".recharts-legend-wrapper")).not.toBeNull();
    expect(screen.getByText("銷量")).toBeInTheDocument();
  });

  it("多數列時渲染 Legend 並列出各數列 label", () => {
    const { container } = render(<ChartCard chart={multiSeriesScatter} />);

    expect(container.querySelector(".recharts-legend-wrapper")).not.toBeNull();
    expect(screen.getByText("銷量")).toBeInTheDocument();
    expect(screen.getByText("成本")).toBeInTheDocument();
  });

  /**
   * 兩軸都是純數值，刻度只有數字——名稱靠 Tooltip 帶出，而 Tooltip 取的是軸的
   * `name`。這與折線圖不同：後者的 X 軸直接把類別名稱寫在刻度上，本身即說明。
   *
   * 不用旋轉的軸標題：recharts 的 Label 依水平可用寬度自動斷詞，中文會被折成
   * 一字一行。比照官方 SimpleScatterChart 改以 name + Tooltip 呈現。
   */
  it("X 軸以 xKey 為名稱", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    expect(axisNameOf(container, "xAxis")).toBe("price");
  });

  it("單一數列時 Y 軸以該數列的 label 為名稱", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    expect(axisNameOf(container, "yAxis")).toBe("銷量");
  });

  // label 是選填的，沒有時回退 key——與圖例的既有規則一致。
  it("數列未提供 label 時 Y 軸名稱回退為 key", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, series: [{ key: "sales" }] }} />
    );
    expect(axisNameOf(container, "yAxis")).toBe("sales");
  });

  /**
   * 多數列時 Y 軸承載的是多個欄位，取其中之一當名稱會對其餘數列說謊；
   * 此時圖例已列出各數列名稱，Y 軸不另取名。
   */
  it("多數列時 Y 軸不取名，X 軸不受影響", () => {
    const { container } = render(<ChartCard chart={multiSeriesScatter} />);

    expect(axisNameOf(container, "yAxis")).toBeFalsy();
    expect(axisNameOf(container, "xAxis")).toBe("price");
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
   * `ZAxis.range` 的單位是**面積**，recharts 內部以 `r = sqrt(size / π)` 反推半徑。
   * 上界 1280 換算後的最大半徑約 20.2px——這條守著「面積→半徑」這個換算沒有接錯，
   * 也守著範圍常數不被誤當成半徑改動。symbol 的 width 即直徑。
   */
  it("最大氣泡的半徑等於面積上界換算出的半徑", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, sizeKey: "profit" }} />
    );
    const maxRadius = Math.max(...bubbleWidthsOf(container)) / 2;

    expect(maxRadius).toBeCloseTo(Math.sqrt(1280 / Math.PI), 1);
  });

  /**
   * 氣泡以資料點為圓心向外擴張，最右側的點會把圓推出繪圖區右緣——
   * recharts 的預設邊距是為線/柱設計的（它們不超出自己的資料點），對散佈圖不夠。
   * 溢出時圓會被 SVG 裁掉半邊，X 軸最後一個刻度也會被蓋住。
   *
   * 上一條測試只驗半徑值本身等於面積上界的換算結果，驗不到它是否撞到邊界；
   * 這條補上真正的幾何邊界檢查。
   */
  it("最右側的氣泡不超出繪圖區右緣", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, sizeKey: "profit" }} />
    );

    // 繪圖區的範圍由格線的端點界定：recharts 不渲染 grid 的 rect，
    // 但每條格線都橫跨整個繪圖區，故其 x / width 即左右邊界。
    const gridLine = container.querySelector(".recharts-cartesian-grid-horizontal line");
    const plotLeft = Number(gridLine?.getAttribute("x"));
    const plotRight = plotLeft + Number(gridLine?.getAttribute("width"));
    // 圖例的圖示也各有一個 `.recharts-surface`（14px 見方），取第一個會抓到它；
    // 圖表本身的那一個掛在 `.recharts-wrapper` 直屬的 svg 上。
    const surface = container.querySelector(".recharts-wrapper > .recharts-surface");
    const plotBottom = Number(surface?.getAttribute("height"));

    // 氣泡以資料點為圓心，四個方向都可能溢出。
    for (const el of scatterSymbolsOf(container)) {
      const cx = Number(el.getAttribute("cx"));
      const cy = Number(el.getAttribute("cy"));
      const r = Number(el.getAttribute("width")) / 2;

      expect(cx - r).toBeGreaterThanOrEqual(plotLeft);
      expect(cx + r).toBeLessThanOrEqual(plotRight);
      expect(cy - r).toBeGreaterThanOrEqual(0);
      expect(cy + r).toBeLessThanOrEqual(plotBottom);
    }
  });

  // 兩軸單位接在刻度後面，讀者不必 hover 就讀得出這個維度是什麼。
  it("提供 xUnit / yUnit 時刻度渲染為數值加單位", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, xUnit: "元", yUnit: "件" }} />
    );
    const ticks = Array.from(
      container.querySelectorAll(".recharts-cartesian-axis-tick-value")
    ).map((el) => el.textContent);

    expect(ticks.some((t) => t?.endsWith("元"))).toBe(true);
    expect(ticks.some((t) => t?.endsWith("件"))).toBe(true);
  });

  /**
   * 單位與大數值縮寫是兩條獨立路徑（`tickFormatter` 與 `unit`），
   * 疊加後的實際輸出必須是 `1.2M件` 這種形狀，而不是其中一條蓋掉另一條。
   */
  it("單位與大數值縮寫並存", () => {
    const { container } = render(
      <ChartCard
        chart={{
          ...scatterChart,
          data: [
            { price: 10, sales: 1_000_000 },
            { price: 20, sales: 4_000_000 },
          ],
          yUnit: "件",
        }}
      />
    );
    const yTicks = Array.from(
      container.querySelectorAll(".recharts-cartesian-axis-tick-value")
    )
      .filter((el) => el.getAttribute("text-anchor") === "end")
      .map((el) => el.textContent);

    expect(yTicks.some((t) => /M件$/.test(t ?? ""))).toBe(true);
  });

  // 未提供單位時刻度維持純數字——選填欄位不該憑空改變既有輸出。
  it("未提供單位時刻度維持純數字", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);
    const ticks = Array.from(
      container.querySelectorAll(".recharts-cartesian-axis-tick-value")
    ).map((el) => el.textContent ?? "");

    expect(ticks.every((t) => /^-?[\d.]+[KMB]?$/.test(t))).toBe(true);
  });
});

/**
 * 圖種名稱對照表：六種齊全，且卡片本身不帶這個標示。
 *
 * 對照表是 `Record<ChartDefinition["type"], string>`，漏一種 TypeScript 就報錯，
 * 故這裡只驗值本身沒被寫錯（如把散佈圖寫成「散布圖」）。
 * 「卡片外」那一條則是刻意的：圖種由呼叫端決定要不要標，不是卡片的一部分。
 */
describe("CHART_KIND_LABEL", () => {
  it("六種圖表各有中文名稱", () => {
    expect(CHART_KIND_LABEL).toEqual({
      line: "折線圖",
      bar: "長條圖",
      area: "區域圖",
      pie: "圓餅圖",
      radar: "雷達圖",
      scatter: "散佈圖",
    });
  });

  it("ChartCard 本身不渲染圖種名稱", () => {
    const { container } = render(<ChartCard chart={scatterChart} />);

    expect(container.querySelector('[data-slot="chart-kind"]')).toBeNull();
    expect(container.textContent).not.toContain("散佈圖");
  });
});

/**
 * 圖例只列各數列，不再有「大小」那一項。
 *
 * 該項曾是氣泡維度唯一的靜態標示管道（見 docs/adr/0007-scatter-static-dimension-labels.md），已依需求移除。這裡守著
 * 「大小項不會回來」與「順序與 series 一致」兩件事——後者不是白守的：
 * recharts 原生收集出來的圖例是反序的，順序全靠自組 payload 撐住。
 */
describe("散佈圖圖例", () => {
  it("提供 sizeKey 時圖例仍只列各數列，不含「大小」項", () => {
    const { container } = render(
      <ChartCard chart={{ ...scatterChart, sizeKey: "profit", sizeLabel: "利潤" }} />
    );
    const items = Array.from(
      container.querySelectorAll(".recharts-legend-item-text")
    ).map((el) => el.textContent);

    expect(items).toEqual(["銷量"]);
    expect(container.textContent).not.toContain("大小");
  });

  it("多數列時圖例列出各數列，順序與 series 一致", () => {
    const { container } = render(<ChartCard chart={multiSeriesScatter} />);
    const items = Array.from(
      container.querySelectorAll(".recharts-legend-item-text")
    ).map((el) => el.textContent);

    expect(items).toEqual(["銷量", "成本"]);
  });

  /**
   * 三個數列才驗得出「反序」與「恰好對調」的差別——兩個數列時兩者看起來一樣。
   * recharts 原生收集會給出 丙乙甲，這條守著自組 payload 沒有被拿掉。
   */
  it("三數列時圖例順序不被 recharts 反轉", () => {
    const threeSeries = {
      ...multiSeriesScatter,
      data: [
        { price: 10, sales: 400, cost: 120, profit: 30 },
        { price: 20, sales: 250, cost: 90, profit: 20 },
      ],
      series: [
        { key: "sales", label: "銷量" },
        { key: "cost", label: "成本" },
        { key: "profit", label: "利潤" },
      ],
    } as ChartDefinition;
    const { container } = render(<ChartCard chart={threeSeries} />);
    const items = Array.from(
      container.querySelectorAll(".recharts-legend-item-text")
    ).map((el) => el.textContent);

    expect(items).toEqual(["銷量", "成本", "利潤"]);
  });
});

/**
 * 氣泡維度的 Tooltip 標示單獨測試：`ZAxis` 不渲染任何 DOM，這兩個值在渲染
 * 斷言中驗不到。`sizeUnit` 是三個單位裡唯一沒有刻度可依附的——接錯了畫面上
 * 看不出來，只能在這裡守住。
 */
describe("bubbleAxisLabels", () => {
  const base = scatterChart as ScatterChartDefinition;

  it("sizeLabel 與 sizeUnit 原樣接到 ZAxis 上", () => {
    expect(
      bubbleAxisLabels({
        ...base,
        sizeKey: "profit",
        sizeLabel: "利潤",
        sizeUnit: "萬元",
      })
    ).toEqual({ dataKey: "profit", name: "利潤", unit: "萬元" });
  });

  // 未提供時回退 sizeKey——與 series[].label 的既有模式一致。
  it("未提供 sizeLabel 時名稱回退為 sizeKey，未提供 sizeUnit 時無單位", () => {
    expect(bubbleAxisLabels({ ...base, sizeKey: "profit" })).toEqual({
      dataKey: "profit",
      name: "profit",
      unit: undefined,
    });
  });
});

/**
 * 軸標題單獨測試：jsdom 下量不到文字尺寸，recharts 因此完全不渲染軸標題
 * （刻度與資料點仍會畫），這在渲染斷言中驗不到。實際版面已在瀏覽器中確認：
 * 兩軸標題各就各位、中文不斷行、圖例移進繪圖區左上角後不與標題相撞（issue #73）。
 */
describe("axisLabel", () => {
  it("未提供時不產生標題", () => {
    expect(axisLabel(undefined, "x")).toBeUndefined();
    expect(axisLabel(undefined, "y")).toBeUndefined();
  });

  /**
   * `width: undefined` 是關閉 recharts 斷行的開關——`Text` 只在收到 width 時
   * 才斷行，而 Y 軸繼承來的 width 是那條窄軸本身的寬度，中文會被折成一字一行。
   * 這個值若被改掉，畫面會退回「一字一行」，故明確斷言。
   */
  it("兩軸都關閉斷行，中文標題才不會被折成一字一行", () => {
    expect(axisLabel("產品售價", "x")?.width).toBeUndefined();
    expect(axisLabel("月銷量", "y")?.width).toBeUndefined();
  });

  it("Y 軸標題旋轉 -90°，X 軸不旋轉", () => {
    expect(axisLabel("月銷量", "y")).toMatchObject({
      value: "月銷量",
      angle: -90,
      position: "insideLeft",
    });
    expect(axisLabel("產品售價", "x")).toMatchObject({
      value: "產品售價",
      angle: 0,
      position: "insideBottom",
    });
  });

  // X 軸標題靠 dy 推到刻度下方；insideBottom 本身會讓它貼在刻度上。
  it("X 軸標題以 dy 推離刻度，Y 軸不需要", () => {
    expect(axisLabel("產品售價", "x")).toHaveProperty("dy");
    expect(axisLabel("月銷量", "y")).not.toHaveProperty("dy");
  });
});
