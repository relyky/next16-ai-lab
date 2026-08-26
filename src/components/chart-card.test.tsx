import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChartCard, seriesColorAt } from "./chart-card";
import type { ChartDefinition } from "@/lib/charts/chart-tool";

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

describe("seriesColorAt", () => {
  it("series 指定 color 時直接使用該值", () => {
    expect(seriesColorAt({ key: "revenue", color: "#ff0000" }, 0)).toBe("#ff0000");
  });

  it("未指定 color 時依序 fallback 到 --chart-1~--chart-5", () => {
    const colors = [0, 1, 2, 3, 4].map((i) => seriesColorAt({ key: `s${i}` }, i));

    expect(colors).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ]);
  });

  it("超過 5 組時循環回到 --chart-1", () => {
    expect(seriesColorAt({ key: "s5" }, 5)).toBe("var(--chart-1)");
    expect(seriesColorAt({ key: "s6" }, 6)).toBe("var(--chart-2)");
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

describe("ChartCard 餅圖", () => {
  it("依資料筆數渲染對應數量的扇形", () => {
    const { container } = render(<ChartCard chart={pieChart} />);
    expect(container.querySelectorAll(".recharts-pie-sector")).toHaveLength(3);
  });

  it("逐扇形循環套用預設配色", () => {
    const { container } = render(<ChartCard chart={pieChart} />);
    const fills = Array.from(
      container.querySelectorAll(".recharts-pie-sector path.recharts-sector")
    ).map((el) => el.getAttribute("fill"));

    expect(fills).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
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
