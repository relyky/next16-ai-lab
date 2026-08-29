// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildAreaChartResult,
  buildBarChartResult,
  buildLineChartResult,
  buildPieChartResult,
  buildRadarChartResult,
  buildScatterChartResult,
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

  // colorKey 與 nameKey / valueKey 同層級：都是「指向 data 內某欄位」。
  it("colorKey 指向的欄位存在且各列皆為 hex 時保留於圖表定義中", () => {
    const input = {
      ...validPieInput,
      data: [
        { item: "原料", amount: 120, tone: "#ff0000" },
        { item: "人力", amount: 80, tone: "#0f0" },
      ],
      colorKey: "tone",
    };
    const result = buildPieChartResult(input);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "pie", ...input });
  });

  it("colorKey 未提供時不出現在圖表定義中", () => {
    expect(chartOf(buildPieChartResult(validPieInput))).not.toHaveProperty("colorKey");
  });

  it("colorKey 不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildPieChartResult({ ...validPieInput, colorKey: "tone" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("tone");
    expect(message).toContain("item");
    expect(message).toContain("amount");
  });

  it("colorKey 的值非 hex 格式時回傳 isError 並指出違規列", () => {
    const data = [
      { item: "原料", amount: 120, tone: "#ff0000" },
      { item: "人力", amount: 80, tone: "紅色" },
    ];
    const result = buildPieChartResult({ ...validPieInput, data, colorKey: "tone" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("tone");
    // 指出是第 2 列（1-based），與既有的負值／非數值訊息風格一致。
    expect(message).toContain("2");
  });

  // 缺值的列回退預設配色是本功能刻意支援的混合案例，
  // 「第 1 列剛好沒有色碼欄位」是其中最自然的寫法之一，不該被誤判為欄位不存在。
  it("colorKey 只出現在後續列時仍視為存在", () => {
    const data = [
      { item: "原料", amount: 120 },
      { item: "人力", amount: 80, tone: "#00ff00" },
    ];
    const result = buildPieChartResult({ ...validPieInput, data, colorKey: "tone" });

    expect(result.isError).toBeFalsy();
  });

  it("零與正數皆為合法值", () => {
    const data = [
      { item: "原料", amount: 0 },
      { item: "人力", amount: 80 },
    ];
    expect(buildPieChartResult({ ...validPieInput, data }).isError).toBeFalsy();
  });
});

/**
 * 雷達圖：類別軸 × 多數列，與笛卡兒圖同構，只是軸換成極座標。
 * 共通的驗證規則走同一份 schema 常數與同一份存在性檢查，此處驗其確實接上。
 */
const validRadarInput = {
  title: "分店評比",
  data: [
    { aspect: "服務", 北店: 80, 南店: 65 },
    { aspect: "價格", 北店: 60, 南店: 90 },
    { aspect: "品質", 北店: 75, 南店: 70 },
  ],
  angleKey: "aspect",
  series: [
    { key: "北店" },
    { key: "南店", color: "#ff0000" },
  ],
};

describe("buildRadarChartResult", () => {
  it("正常輸入回傳 type 為 radar 的圖表定義 JSON", () => {
    const result = buildRadarChartResult(validRadarInput);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "radar", ...validRadarInput });
  });

  it("title 未提供時不出現在圖表定義中", () => {
    const noTitle = {
      data: validRadarInput.data,
      angleKey: validRadarInput.angleKey,
      series: validRadarInput.series,
    };
    expect(chartOf(buildRadarChartResult(noTitle))).not.toHaveProperty("title");
  });

  // 錯誤訊息的標籤須是 angleKey 而非 xKey——雷達圖沒有 X 軸，
  // 訊息說 xKey 會讓 LLM 去找一個它根本沒傳的欄位。
  it("angleKey 不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildRadarChartResult({ ...validRadarInput, angleKey: "面向" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("angleKey");
    expect(message).toContain("面向");
    expect(message).toContain("aspect");
  });

  it("series 的欄位不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildRadarChartResult({
      ...validRadarInput,
      series: [{ key: "東店" }],
    });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("東店");
    expect(message).toContain("aspect");
  });

  // 雷達圖沒有 X 軸：誤傳笛卡兒圖的形狀應在驗證階段就被擋下。
  it("誤傳笛卡兒圖的 xKey 時回傳驗證錯誤", () => {
    expect(buildRadarChartResult(validInput).isError).toBe(true);
  });

  it("傳入未知欄位時回傳 isError 並指出該欄位", () => {
    const result = buildRadarChartResult({ ...validRadarInput, bogus: true });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("bogus");
  });

  it("data 為空陣列時回傳 isError", () => {
    expect(buildRadarChartResult({ ...validRadarInput, data: [] }).isError).toBe(true);
  });

  // 上限與既有圖表一致，LLM 對限制才有一致認知。
  it("data 超過 100 筆時回傳驗證錯誤", () => {
    const data = Array.from({ length: 101 }, (_, i) => ({ aspect: `面向${i}`, 北店: i }));
    const result = buildRadarChartResult({ ...validRadarInput, data, series: [{ key: "北店" }] });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("data");
  });

  it("series 超過 6 組時回傳驗證錯誤", () => {
    const series = Array.from({ length: 7 }, (_, i) => ({ key: `s${i}` }));
    const result = buildRadarChartResult({ ...validRadarInput, series });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("series");
  });

  it("series 為空陣列時回傳驗證錯誤", () => {
    expect(buildRadarChartResult({ ...validRadarInput, series: [] }).isError).toBe(true);
  });

  it("series[].color 非 hex 格式時回傳驗證錯誤", () => {
    const result = buildRadarChartResult({
      ...validRadarInput,
      series: [{ key: "北店", color: "red" }],
    });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("color");
  });
});

/**
 * 散佈圖：連續數值 X 軸 × 多數列，外加選填的氣泡大小維度。
 * 座標值必須是數值但**允許負數**——這是與餅圖非負約束區隔開來的關鍵。
 */
const validScatterInput = {
  title: "價格與銷量",
  data: [
    { price: 10, sales: 400, profit: 5 },
    { price: 20, sales: 250, profit: 50 },
    { price: 30, sales: 600, profit: 0 },
  ],
  xKey: "price",
  series: [{ key: "sales", label: "銷量" }],
};

describe("buildScatterChartResult", () => {
  it("正常輸入回傳 type 為 scatter 的圖表定義 JSON", () => {
    const result = buildScatterChartResult(validScatterInput);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "scatter", ...validScatterInput });
  });

  // 定義 JSON 保持稀疏：沒傳的選填欄位不該憑空出現。
  it("未提供 sizeKey 時不出現在圖表定義中", () => {
    const chart = chartOf(buildScatterChartResult(validScatterInput));

    expect(chart).not.toHaveProperty("sizeKey");
  });

  it("title 未提供時不出現在圖表定義中", () => {
    const noTitle = {
      data: validScatterInput.data,
      xKey: validScatterInput.xKey,
      series: validScatterInput.series,
    };
    expect(chartOf(buildScatterChartResult(noTitle))).not.toHaveProperty("title");
  });

  // 座標本來就可以是負的（溫差、損益）；與餅圖 valueKey 的非負約束語意不同。
  it("負座標可正常通過", () => {
    const data = [
      { temp: -10, delta: -5 },
      { temp: 20, delta: 8 },
    ];
    const result = buildScatterChartResult({
      data,
      xKey: "temp",
      series: [{ key: "delta" }],
    });

    expect(result.isError).toBeFalsy();
  });

  // 不擋就是靜默畫出一張空圖，而 LLM 拿不到可自行修正的訊息。
  it("某列 x 值不是數值時回傳 isError 並指出該列", () => {
    const data = [
      { price: 10, sales: 400 },
      { price: "二十", sales: 250 },
    ];
    const result = buildScatterChartResult({ ...validScatterInput, data });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("price");
    expect(message).toContain("2");
  });

  it("某列 y 值不是數值時回傳 isError 並指出該列", () => {
    const data = [
      { price: 10, sales: 400 },
      { price: 20, sales: 250 },
      { price: 30, sales: "六百" },
    ];
    const result = buildScatterChartResult({ ...validScatterInput, data });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("sales");
    expect(message).toContain("3");
  });

  it("xKey 不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildScatterChartResult({ ...validScatterInput, xKey: "cost" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("cost");
    expect(message).toContain("price");
  });

  it("series 的欄位不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildScatterChartResult({
      ...validScatterInput,
      series: [{ key: "volume" }],
    });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("volume");
    expect(message).toContain("price");
  });

  // 沿用既有的共通失敗案例行為。
  it("data 為空陣列時回傳 isError", () => {
    expect(buildScatterChartResult({ ...validScatterInput, data: [] }).isError).toBe(true);
  });

  it("data 超過 100 筆時回傳驗證錯誤", () => {
    const data = Array.from({ length: 101 }, (_, i) => ({ price: i, sales: i * 2 }));
    const result = buildScatterChartResult({ ...validScatterInput, data });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("data");
  });

  it("series 超過 6 組時回傳驗證錯誤", () => {
    const series = Array.from({ length: 7 }, (_, i) => ({ key: `s${i}` }));
    const result = buildScatterChartResult({ ...validScatterInput, series });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("series");
  });

  it("series 為空陣列時回傳驗證錯誤", () => {
    expect(buildScatterChartResult({ ...validScatterInput, series: [] }).isError).toBe(true);
  });

  it("series[].color 非 hex 格式時回傳驗證錯誤", () => {
    const result = buildScatterChartResult({
      ...validScatterInput,
      series: [{ key: "sales", color: "red" }],
    });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("color");
  });

  it("傳入未知欄位時回傳 isError 並指出該欄位", () => {
    const result = buildScatterChartResult({ ...validScatterInput, bogus: true });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("bogus");
  });
});

/**
 * 氣泡大小：散佈圖相對於其他圖表的獨特價值。
 * 氣泡幾何由前端固定的 `ZAxis.range` 承擔，契約只收 `sizeKey` 與它的標示欄位，
 * 不再開放呼叫端調整大小範圍——詳見 docs/adr/0005 的「後續修正」一節。
 */
describe("buildScatterChartResult 的氣泡大小", () => {
  it("提供 sizeKey 時如實帶入圖表定義", () => {
    const input = { ...validScatterInput, sizeKey: "profit" };
    const result = buildScatterChartResult(input);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "scatter", ...input });
  });

  it("sizeKey 不存在於 data 時回傳 isError 並附上可用欄位", () => {
    const result = buildScatterChartResult({ ...validScatterInput, sizeKey: "margin" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("sizeKey");
    expect(message).toContain("margin");
    expect(message).toContain("price");
  });

  // recharts 會把負值靜默夾成 0，畫出一個看不見的點——
  // 這種靜默失敗比畫錯更難察覺。檢查方式比照餅圖 valueKey。
  it("sizeKey 某列為負數時回傳 isError 並指出該列（1-based）", () => {
    const data = [
      { price: 10, sales: 400, profit: 5 },
      { price: 20, sales: 250, profit: -50 },
    ];
    const result = buildScatterChartResult({ ...validScatterInput, data, sizeKey: "profit" });

    expect(result.isError).toBe(true);
    const message = errorTextOf(result);
    expect(message).toContain("profit");
    expect(message).toContain("2");
  });

  it("sizeKey 某列非數值時回傳 isError 並指出該列", () => {
    const data = [
      { price: 10, sales: 400, profit: 5 },
      { price: 20, sales: 250, profit: "高" },
    ];
    const result = buildScatterChartResult({ ...validScatterInput, data, sizeKey: "profit" });

    expect(result.isError).toBe(true);
    expect(errorTextOf(result)).toContain("profit");
  });

  // 零是非負，須放行——這是 `value < 0` 與 `value <= 0` 的分界，
  // 資料裡必須真的有一列為 0，否則這支測試守不住那條邊界。
  it("sizeKey 某列為零時視為合法值", () => {
    const data = [
      { price: 10, sales: 400, profit: 0 },
      { price: 20, sales: 250, profit: 50 },
    ];
    const result = buildScatterChartResult({ ...validScatterInput, data, sizeKey: "profit" });

    expect(result.isError).toBeFalsy();
  });
});

/**
 * 四個選填的標示欄位（#68）：散佈圖的三個維度在靜態畫面上要讀得出來，
 * 而這四個欄位是那些標示的唯一來源。
 */
describe("buildScatterChartResult 的維度標示欄位", () => {
  it("四個欄位原樣進入圖表定義", () => {
    const input = {
      ...validScatterInput,
      xUnit: "元",
      yUnit: "千件",
      sizeKey: "profit",
      sizeLabel: "利潤",
      sizeUnit: "萬元",
    };
    const result = buildScatterChartResult(input);

    expect(result.isError).toBeFalsy();
    expect(chartOf(result)).toEqual({ type: "scatter", ...input });
  });

  // 圖表定義 JSON 保持稀疏：沒傳就不該憑空出現該欄位。
  it("四個欄位未提供時圖表定義不出現該欄位", () => {
    const chart = chartOf(buildScatterChartResult(validScatterInput));

    for (const field of ["xUnit", "yUnit", "sizeLabel", "sizeUnit"]) {
      expect(chart).not.toHaveProperty(field);
    }
  });

  // 兩個軸的單位與氣泡無關，不需要 sizeKey 就能單獨提供。
  it("只提供 xUnit / yUnit 時通過，不需要 sizeKey", () => {
    const result = buildScatterChartResult({
      ...validScatterInput,
      xUnit: "元",
      yUnit: "千件",
    });

    expect(result.isError).toBeFalsy();
  });

  /**
   * sizeLabel / sizeUnit 描述的是氣泡這個維度，沒有 sizeKey 時沒有維度可描述。
   * 明確回報而非靜默忽略，否則 LLM 會以為自己成功標了名稱。
   */
  it.each(["sizeLabel", "sizeUnit"])(
    "只傳 %s 卻沒傳 sizeKey 時回傳 isError",
    (field) => {
      const result = buildScatterChartResult({
        ...validScatterInput,
        [field]: "利潤",
      });

      expect(result.isError).toBe(true);
      expect(errorTextOf(result)).toContain(field);
    }
  );

  // 空字串是「有這個欄位但沒有內容」，畫出來的標示會是空白，故在 schema 層擋下。
  it.each(["xUnit", "yUnit"])("%s 為空字串時回傳 isError", (field) => {
    const result = buildScatterChartResult({ ...validScatterInput, [field]: "" });

    expect(result.isError).toBe(true);
  });
});
