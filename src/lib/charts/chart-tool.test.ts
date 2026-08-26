// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildAreaChartResult,
  buildBarChartResult,
  buildLineChartResult,
  buildPieChartResult,
} from "./chart-tool";

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

/** 三個笛卡兒圖轉換函式的對照表：type 與具名函式。 */
const CARTESIAN_BUILDERS = [
  ["line", buildLineChartResult],
  ["bar", buildBarChartResult],
  ["area", buildAreaChartResult],
] as const;

describe("笛卡兒圖轉換函式", () => {
  it("正常輸入回傳對應 type 的圖表定義 JSON", () => {
    const result = buildLineChartResult(validInput);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({
      type: "line",
      title: "月營收趨勢",
      data: validInput.data,
      xKey: "month",
      series: validInput.series,
    });
  });

  it.each(CARTESIAN_BUILDERS)("固定帶入 type: %s", (type, build) => {
    expect(chartOf(build(validInput))?.type).toBe(type);
  });

  // 共通的驗證規則以 line 為代表測一次；三個函式走的是同一份 schema 與 helper。
  it("title 未提供時不出現在圖表定義中", () => {
    const noTitle = { data: validInput.data, xKey: validInput.xKey, series: validInput.series };
    expect(chartOf(buildLineChartResult(noTitle))).not.toHaveProperty("title");
  });

  it("data 為空陣列時回傳 isError", () => {
    const result = buildLineChartResult({ ...validInput, data: [] });
    expect(result.isError).toBe(true);
  });

  it("xKey 不存在於 data[0] 時回傳 isError 並指出欄位名稱", () => {
    const result = buildLineChartResult({ ...validInput, xKey: "quarter" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("quarter");
    // 錯誤訊息需提示實際可用的欄位，LLM 才有辦法自行修正。
    expect(message).toContain("month");
  });

  it("data 超過 100 筆時回傳驗證錯誤", () => {
    const data = Array.from({ length: 101 }, (_, i) => ({ month: `${i}月`, revenue: i }));
    const result = buildLineChartResult({ ...validInput, data });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("data");
  });

  it("series 超過 6 組時回傳驗證錯誤", () => {
    const series = Array.from({ length: 7 }, (_, i) => ({ key: `s${i}` }));
    const result = buildLineChartResult({ ...validInput, series });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("series");
  });

  it("series[].color 非 hex 格式時回傳驗證錯誤", () => {
    const result = buildLineChartResult({
      ...validInput,
      series: [{ key: "revenue", color: "red" }],
    });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("color");
  });

  it("series 為空陣列時回傳驗證錯誤", () => {
    const result = buildLineChartResult({ ...validInput, series: [] });
    expect(result.isError).toBe(true);
  });

  // 未知欄位靜默忽略會畫出一張參數對不上的圖；錯誤訊息需指出是哪個欄位。
  it.each(CARTESIAN_BUILDERS)("%s 傳入未知欄位時回傳 isError 並指出該欄位", (_type, build) => {
    const result = build({ ...validInput, bogus: true });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("bogus");
  });
});

/**
 * stacked 僅 bar/area 接受。定義 JSON 保持稀疏：沒傳就沒有這個欄位，
 * 由前端的類型對照表回退到該圖表類型的預設。
 */
describe("stacked", () => {
  const STACKED_BUILDERS = [
    ["bar", buildBarChartResult],
    ["area", buildAreaChartResult],
  ] as const;

  it.each(STACKED_BUILDERS)("%s 未傳 stacked 時定義 JSON 不含該欄位", (_type, build) => {
    expect(chartOf(build(validInput))).not.toHaveProperty("stacked");
  });

  it.each(STACKED_BUILDERS)("%s 傳入 stacked: true 時如實帶入定義 JSON", (_type, build) => {
    expect(chartOf(build({ ...validInput, stacked: true }))?.stacked).toBe(true);
  });

  it.each(STACKED_BUILDERS)("%s 傳入 stacked: false 時如實帶入定義 JSON", (_type, build) => {
    expect(chartOf(build({ ...validInput, stacked: false }))?.stacked).toBe(false);
  });

  // 堆疊折線容易被讀者誤讀成累加值而非獨立值，故折線圖不提供此參數。
  it("line 傳入 stacked 時回傳 isError 並指出該欄位", () => {
    const result = buildLineChartResult({ ...validInput, stacked: true });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("stacked");
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

  // 扇形角度直接由值決定，非數值或負數會畫出無意義的圖。
  // data 欄位的型別允許字串（類別名稱本來就是字串），故只能在執行期比對。
  it("valueKey 的值為非數值時回傳 isError 並指出違規列", () => {
    const data = [
      { item: "原料", amount: 120 },
      { item: "人力", amount: "八十" },
    ];
    const result = buildPieChartResult({ ...validPieInput, data });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("amount");
    // 指出是第 2 列（1-based），LLM 才知道要改哪一筆。
    expect(message).toContain("2");
  });

  it("valueKey 的值為負數時回傳 isError 並指出違規列", () => {
    const data = [
      { item: "原料", amount: 120 },
      { item: "人力", amount: 80 },
      { item: "行銷", amount: -40 },
    ];
    const result = buildPieChartResult({ ...validPieInput, data });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("amount");
    expect(message).toContain("3");
  });

  it("零與正數皆為合法值", () => {
    const data = [
      { item: "原料", amount: 0 },
      { item: "人力", amount: 80 },
    ];
    expect(buildPieChartResult({ ...validPieInput, data }).isError).toBeFalsy();
  });
});
