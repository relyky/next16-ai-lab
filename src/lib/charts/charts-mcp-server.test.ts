// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  areaChartTool,
  barChartTool,
  chartTools,
  createChartsMcpServer,
  lineChartTool,
  pieChartTool,
} from "./charts-mcp-server";

const validArgs = {
  title: "月營收趨勢",
  data: [
    { month: "1月", revenue: 120 },
    { month: "2月", revenue: 150 },
  ],
  xKey: "month",
  series: [{ key: "revenue", label: "營收" }],
};

/** 串接 tool result 內的 text content。 */
function textOf(result: unknown) {
  const content = ((result as { content?: unknown }).content ?? []) as {
    text?: string;
  }[];
  return content.map((c) => c.text ?? "").join("\n");
}

/** 三個 tool 的對照表：type、tool 名稱、tool 實例，三處測試共用。 */
const CHART_TOOLS = [
  ["line", "line_chart", lineChartTool],
  ["bar", "bar_chart", barChartTool],
  ["area", "area_chart", areaChartTool],
] as const;

describe("charts MCP server", () => {
  it("以 sdk（in-process）型式掛載，server 名稱為 charts", () => {
    const server = createChartsMcpServer();

    // 名稱決定工具全名 mcp__charts__*，chat route 的 allowedTools 靠它放行。
    expect(server).toMatchObject({ type: "sdk", name: "charts" });
  });

  it.each(CHART_TOOLS)("註冊 %s 的 tool 並附上描述", (_type, name, chartTool) => {
    expect(chartTool.name).toBe(name);
    expect(chartTool.description).toBeTruthy();
  });

  it("四個 tool 全數註冊到 server", () => {
    expect(chartTools).toEqual([lineChartTool, barChartTool, areaChartTool, pieChartTool]);
  });

  it("註冊 pie 的 tool 並附上描述", () => {
    expect(pieChartTool.name).toBe("pie_chart");
    expect(pieChartTool.description).toBeTruthy();
  });

  it("呼叫 pie_chart tool 回傳 type 為 pie 的圖表定義 JSON", async () => {
    const pieArgs = {
      title: "成本結構",
      data: [
        { item: "原料", amount: 120 },
        { item: "人力", amount: 80 },
      ],
      nameKey: "item",
      valueKey: "amount",
    };
    const result = await pieChartTool.handler(pieArgs, {});

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ type: "pie", ...pieArgs });
  });

  it.each(CHART_TOOLS)(
    "呼叫 %s tool 回傳對應 type 的圖表定義 JSON",
    async (type, _name, chartTool) => {
      const result = await chartTool.handler(validArgs, {});

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(textOf(result))).toEqual({ type, ...validArgs });
    }
  );

  // 其餘驗證規則的邊界情境已在 chart-tool.test.ts 覆蓋；
  // 這裡只確認錯誤能原樣經由 tool handler 傳回。
  it.each(CHART_TOOLS)(
    "%s tool 驗證失敗時回傳 isError 與具體錯誤訊息",
    async (_type, _name, chartTool) => {
      const result = await chartTool.handler({ ...validArgs, xKey: "quarter" }, {});

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("quarter");
    }
  );
});
