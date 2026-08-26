// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildChartResult, buildPieChartResult } from "./chart-tool";

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

const validPieInput = {
  title: "成本結構",
  data: [
    { item: "原料", amount: 120 },
    { item: "人力", amount: 80 },
    { item: "行銷", amount: 0 },
  ],
  nameKey: "item",
  valueKey: "amount",
};

describe("buildPieChartResult", () => {
  it("正常輸入回傳 type 為 pie 的圖表定義 JSON", () => {
    const result = buildPieChartResult(validPieInput);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "pie", ...validPieInput });
  });

  it("title 未提供時不出現在圖表定義中", () => {
    const noTitle = {
      data: validPieInput.data,
      nameKey: validPieInput.nameKey,
      valueKey: validPieInput.valueKey,
    };
    expect(chartOf(buildPieChartResult(noTitle))).not.toHaveProperty("title");
  });

  it("nameKey 不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildPieChartResult({ ...validPieInput, nameKey: "category" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("category");
    expect(message).toContain("item");
    expect(message).toContain("amount");
  });

  it("valueKey 不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildPieChartResult({ ...validPieInput, valueKey: "total" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("total");
    expect(message).toContain("item");
  });

  // 餅圖沒有數列概念：多傳笛卡兒圖的參數形狀應在驗證階段就被擋下。
  it("誤傳笛卡兒圖的 xKey/series 參數時回傳驗證錯誤", () => {
    const result = buildPieChartResult(validInput);
    expect(result.isError).toBe(true);
  });

  it("data 為空陣列時回傳 isError", () => {
    expect(buildPieChartResult({ ...validPieInput, data: [] }).isError).toBe(true);
  });

  it("data 超過 100 筆時回傳驗證錯誤", () => {
    const data = Array.from({ length: 101 }, (_, i) => ({ item: `項目${i}`, amount: i }));
    const result = buildPieChartResult({ ...validPieInput, data });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("data");
  });
});
