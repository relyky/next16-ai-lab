// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  areaChartTool,
  barChartTool,
  chartTools,
  createChartsMcpServer,
  lineChartTool,
  pieChartTool,
  radarChartTool,
  scatterChartTool,
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

/**
 * 散佈圖版的同款 helper：`sizeKey` / `range` 選填，但 handler 的參數型別
 * 把選填欄位表述為「必填但可為 undefined」，實際呼叫時仍可省略。
 */
function asScatterToolArgs(args: Record<string, unknown>) {
  return args as unknown as Parameters<typeof scatterChartTool.handler>[0];
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

  it("六個 tool 全數註冊到 server", () => {
    expect(chartTools).toEqual([
      lineChartTool,
      barChartTool,
      areaChartTool,
      pieChartTool,
      radarChartTool,
      scatterChartTool,
    ]);
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

  it("註冊 radar 的 tool 並附上描述", () => {
    expect(radarChartTool.name).toBe("radar_chart");
    expect(radarChartTool.description).toBeTruthy();
  });

  // 雷達圖與笛卡兒圖同樣是「每組數列一色」，配色說明的落點也相同。
  it("radar tool 的描述說明以數列顏色配色與適用情境", () => {
    expect(radarChartTool.description).toContain("series[].color");
    expect(radarChartTool.description).toContain("預設配色");
    expect(radarChartTool.description).toContain("angleKey");
    // 適用情境：多維度指標的整體輪廓比較。
    expect(radarChartTool.description).toContain("輪廓");
  });

  it("呼叫 radar_chart tool 回傳 type 為 radar 的圖表定義 JSON", async () => {
    const radarArgs = {
      title: "分店評比",
      data: [
        { aspect: "服務", 北店: 80 },
        { aspect: "價格", 北店: 60 },
      ],
      angleKey: "aspect",
      series: [{ key: "北店" }],
    };
    const result = await radarChartTool.handler(
      radarArgs as Parameters<typeof radarChartTool.handler>[0],
      {}
    );

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ type: "radar", ...radarArgs });
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

/**
 * 散佈圖：氣泡大小是本功能最有價值的部分，而選填欄位的說明只存在於巢狀
 * JSON Schema 的 property description 裡（ADR 0003）。故 sizeKey 與 range
 * 的用法必須寫進 tool 的**描述**，否則 LLM 從不主動使用，等於沒做。
 */
describe("scatter tool", () => {
  it("註冊 scatter 的 tool 並附上描述", () => {
    expect(scatterChartTool.name).toBe("scatter_chart");
    expect(scatterChartTool.description).toBeTruthy();
  });

  it("描述說明適用情境、數值欄位要求與配色方式", () => {
    // 適用情境：兩個數值變數的分布與相關性。
    expect(scatterChartTool.description).toContain("相關性");
    // X 軸與各數列 key 都必須是數值欄位。
    expect(scatterChartTool.description).toContain("數值欄位");
    expect(scatterChartTool.description).toContain("series[].color");
    expect(scatterChartTool.description).toContain("預設配色");
  });

  it("描述明文寫出 sizeKey 為選填、非負、未提供時所有點大小相同", () => {
    expect(scatterChartTool.description).toContain("sizeKey");
    expect(scatterChartTool.description).toContain("非負");
    expect(scatterChartTool.description).toContain("所有點大小相同");
  });

  it("描述明文寫出 range 為半徑範圍及未提供時的預設值", () => {
    expect(scatterChartTool.description).toContain("半徑");
    expect(scatterChartTool.description).toContain("[4, 12]");
  });

  it("呼叫 scatter_chart tool 回傳 type 為 scatter 的圖表定義 JSON", async () => {
    const scatterArgs = {
      title: "價格與銷量",
      data: [
        { price: 10, sales: 400 },
        { price: 20, sales: 250 },
      ],
      xKey: "price",
      series: [{ key: "sales" }],
    };
    const result = await scatterChartTool.handler(asScatterToolArgs(scatterArgs), {});

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ type: "scatter", ...scatterArgs });
  });
});
