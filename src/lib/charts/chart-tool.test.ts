// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildChartResult } from "./chart-tool";

const validInput = {
  title: "月營收趨勢",
  data: [
    { month: "1月", revenue: 120, cost: 80 },
    { month: "2月", revenue: 150, cost: 90 },
  ],
  xKey: "month",
  series: [
    { key: "revenue", label: "營收" },
    { key: "cost", label: "成本", color: "#ff0000" },
  ],
};

/** 取出 tool result 內的圖表定義 JSON（失敗時回傳 undefined）。 */
function chartOf(result: { isError?: boolean; content: { type: string; text?: string }[] }) {
  if (result.isError) return undefined;
  const text = result.content.find((c) => c.type === "text")?.text ?? "";
  return JSON.parse(text);
}

/** 取出錯誤訊息文字。 */
function errorTextOf(result: { content: { type: string; text?: string }[] }) {
  return result.content.map((c) => c.text ?? "").join("\n");
}

describe("buildChartResult", () => {
  it("正常輸入回傳對應 type 的圖表定義 JSON", () => {
    const result = buildChartResult("line", validInput);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({
      type: "line",
      title: "月營收趨勢",
      data: validInput.data,
      xKey: "month",
      series: validInput.series,
    });
  });

  it.each(["line", "bar", "area"] as const)("固定帶入 type: %s", (type) => {
    expect(chartOf(buildChartResult(type, validInput))?.type).toBe(type);
  });

  it("title 未提供時不出現在圖表定義中", () => {
    const noTitle = { data: validInput.data, xKey: validInput.xKey, series: validInput.series };
    expect(chartOf(buildChartResult("line", noTitle))).not.toHaveProperty("title");
  });

  it("data 為空陣列時回傳 isError", () => {
    const result = buildChartResult("line", { ...validInput, data: [] });
    expect(result.isError).toBe(true);
  });

  it("xKey 不存在於 data[0] 時回傳 isError 並指出欄位名稱", () => {
    const result = buildChartResult("line", { ...validInput, xKey: "quarter" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("quarter");
    // 錯誤訊息需提示實際可用的欄位，LLM 才有辦法自行修正。
    expect(message).toContain("month");
  });

  it("data 超過 100 筆時回傳驗證錯誤", () => {
    const data = Array.from({ length: 101 }, (_, i) => ({ month: `${i}月`, revenue: i }));
    const result = buildChartResult("line", { ...validInput, data });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("data");
  });

  it("series 超過 6 組時回傳驗證錯誤", () => {
    const series = Array.from({ length: 7 }, (_, i) => ({ key: `s${i}` }));
    const result = buildChartResult("line", { ...validInput, series });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("series");
  });

  it("series[].color 非 hex 格式時回傳驗證錯誤", () => {
    const result = buildChartResult("line", {
      ...validInput,
      series: [{ key: "revenue", color: "red" }],
    });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("color");
  });

  it("series 為空陣列時回傳驗證錯誤", () => {
    const result = buildChartResult("line", { ...validInput, series: [] });
    expect(result.isError).toBe(true);
  });
});
