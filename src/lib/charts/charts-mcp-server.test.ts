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

/**
 * `it.each` 會把三個 tool 的型別合成聯集，其 handler 參數型別隨之交集，
 * bar/area 專有的 `stacked` 因而變成必填。實際呼叫時該欄位可省略
 * （選填），此 helper 只負責補上型別層要的形狀。
 */
function asToolArgs(args: Record<string, unknown>) {
  return args as Parameters<typeof barChartTool.handler>[0] &
    Parameters<typeof lineChartTool.handler>[0];
}

/**
 * 餅圖版的同款 helper：`colorKey` 選填，但 handler 的參數型別把選填欄位
 * 表述為「必填但可為 undefined」，實際呼叫時仍可省略。
 */
function asPieToolArgs(args: Record<string, unknown>) {
  return args as Parameters<typeof pieChartTool.handler>[0];
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

  // schema 開了 AI 也未必會用：顏色若只寫在巢狀 JSON Schema 的 property description 裡，
  // AI 讀不到就不會產生彩色圖。描述是這個功能真的被用起來的最後一哩。
  it.each(CHART_TOOLS)("%s tool 的描述說明以數列顏色配色", (_type, _name, chartTool) => {
    expect(chartTool.description).toContain("series[].color");
    expect(chartTool.description).toContain("預設配色");
  });

  it("pie tool 的描述說明以 colorKey 配色", () => {
    expect(pieChartTool.description).toContain("colorKey");
    expect(pieChartTool.description).toContain("預設配色");
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
    // handler 的參數型別把選填欄位表述為「必填但可為 undefined」，
    // 實際呼叫時可省略；此處與笛卡兒圖的 asToolArgs 同理只補上型別層要的形狀。
    const result = await pieChartTool.handler(asPieToolArgs(pieArgs), {});

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ type: "pie", ...pieArgs });
  });

  it.each(CHART_TOOLS)(
    "呼叫 %s tool 回傳對應 type 的圖表定義 JSON",
    async (type, _name, chartTool) => {
      const result = await chartTool.handler(asToolArgs(validArgs), {});

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(textOf(result))).toEqual({ type, ...validArgs });
    }
  );

  // 其餘驗證規則的邊界情境已在 chart-tool.test.ts 覆蓋；
  // 這裡只確認錯誤能原樣經由 tool handler 傳回。
  it.each(CHART_TOOLS)(
    "%s tool 驗證失敗時回傳 isError 與具體錯誤訊息",
    async (_type, _name, chartTool) => {
      const result = await chartTool.handler(
        asToolArgs({ ...validArgs, xKey: "quarter" }),
        {}
      );

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("quarter");
    }
  );
});
