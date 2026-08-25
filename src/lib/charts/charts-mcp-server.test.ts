// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createChartsMcpServer, lineChartTool } from "./charts-mcp-server";

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

describe("charts MCP server", () => {
  it("以 sdk（in-process）型式掛載，server 名稱為 charts", () => {
    const server = createChartsMcpServer();

    // 名稱決定工具全名 mcp__charts__*，chat route 的 allowedTools 靠它放行。
    expect(server).toMatchObject({ type: "sdk", name: "charts" });
  });

  it("註冊 line_chart tool 並附上描述", () => {
    expect(lineChartTool.name).toBe("line_chart");
    expect(lineChartTool.description).toBeTruthy();
  });

  it("呼叫 line_chart 回傳 type 為 line 的圖表定義 JSON", async () => {
    const result = await lineChartTool.handler(validArgs, {});

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ type: "line", ...validArgs });
  });

  // 其餘驗證規則的邊界情境已在 chart-tool.test.ts 覆蓋；
  // 這裡只確認錯誤能原樣經由 tool handler 傳回。
  it("驗證失敗時回傳 isError 與具體錯誤訊息", async () => {
    const result = await lineChartTool.handler({ ...validArgs, xKey: "quarter" }, {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("quarter");
  });
});
