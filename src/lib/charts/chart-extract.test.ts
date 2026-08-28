// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createChartExtractor } from "./chart-extract";

const definition = {
  type: "line" as const,
  title: "月營收",
  data: [{ month: "1月", revenue: 120 }],
  xKey: "month",
  series: [{ key: "revenue" }],
};

function toolUse(id: string, name: string) {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name, input: {} }] } };
}

function toolResult(toolUseId: string, content: unknown) {
  return {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  };
}

describe("createChartExtractor", () => {
  it("取出 charts tool 回傳的圖表定義", () => {
    const extract = createChartExtractor();

    expect(extract(toolUse("t-1", "mcp__charts__line_chart"))).toEqual([]);
    expect(extract(toolResult("t-1", JSON.stringify(definition)))).toEqual([definition]);
  });

  it("圖表內容以陣列形式的 content block 承載時同樣取得出來", () => {
    const extract = createChartExtractor();

    extract(toolUse("t-1", "mcp__charts__bar_chart"));
    const chart = { ...definition, type: "bar" as const };

    expect(
      extract(toolResult("t-1", [{ type: "text", text: JSON.stringify(chart) }]))
    ).toEqual([chart]);
  });

  it("一則回應含多次圖表呼叫時，依序取出多張圖表", () => {
    const extract = createChartExtractor();
    const second = { ...definition, type: "area" as const, title: "毛利" };

    extract(toolUse("t-1", "mcp__charts__line_chart"));
    extract(toolUse("t-2", "mcp__charts__area_chart"));

    expect(extract(toolResult("t-1", JSON.stringify(definition)))).toEqual([definition]);
    expect(extract(toolResult("t-2", JSON.stringify(second)))).toEqual([second]);
  });

  it("同一則 user message 內含多個圖表結果時一次取出", () => {
    const extract = createChartExtractor();
    extract(toolUse("t-1", "mcp__charts__line_chart"));
    extract(toolUse("t-2", "mcp__charts__line_chart"));

    const message = {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t-1", content: JSON.stringify(definition) },
          { type: "tool_result", tool_use_id: "t-2", content: JSON.stringify(definition) },
        ],
      },
    };

    expect(extract(message)).toEqual([definition, definition]);
  });

  // union 置換了擷取邏輯唯一依賴的 schema，需證明餅圖這條路沒斷。
  it("取出 pie_chart 回傳的餅圖定義", () => {
    const extract = createChartExtractor();
    const pie = {
      type: "pie" as const,
      title: "成本結構",
      data: [
        { item: "原料", amount: 120 },
        { item: "人力", amount: 80 },
      ],
      nameKey: "item",
      valueKey: "amount",
    };

    extract(toolUse("t-1", "mcp__charts__pie_chart"));

    expect(extract(toolResult("t-1", JSON.stringify(pie)))).toEqual([pie]);
  });

  // colorKey 帶的是 hex 字串，data 欄位的值型別本來就接受字串；
  // round-trip 通過即證明擷取端不需為此放寬 schema。
  it("取出帶 colorKey 的餅圖定義", () => {
    const extract = createChartExtractor();
    const pie = {
      type: "pie" as const,
      data: [
        { item: "原料", amount: 120, tone: "#ff0000" },
        { item: "人力", amount: 80, tone: "#00ff00" },
      ],
      nameKey: "item",
      valueKey: "amount",
      colorKey: "tone",
    };

    extract(toolUse("t-1", "mcp__charts__pie_chart"));

    expect(extract(toolResult("t-1", JSON.stringify(pie)))).toEqual([pie]);
  });

  it("餅圖內容不符 schema 時不產生圖表", () => {
    const extract = createChartExtractor();

    extract(toolUse("t-1", "mcp__charts__pie_chart"));

    // 缺 valueKey：判別子對得上但分支欄位不齊，仍須被擋下。
    expect(
      extract(
        toolResult("t-1", JSON.stringify({ type: "pie", data: [{ item: "原料" }], nameKey: "item" }))
      )
    ).toEqual([]);
  });

  it("非 charts server 的 tool_result 一律略過，即使內容恰好符合圖表格式", () => {
    const extract = createChartExtractor();

    extract(toolUse("t-1", "mcp__qadb__search"));

    expect(extract(toolResult("t-1", JSON.stringify(definition)))).toEqual([]);
  });

  it("charts tool 回報錯誤時不產生圖表", () => {
    const extract = createChartExtractor();

    extract(toolUse("t-1", "mcp__charts__line_chart"));

    expect(extract(toolResult("t-1", "圖表參數驗證失敗 → xKey: 不存在"))).toEqual([]);
  });

  it("內容不符圖表 schema 時不產生圖表", () => {
    const extract = createChartExtractor();

    extract(toolUse("t-1", "mcp__charts__line_chart"));

    expect(extract(toolResult("t-1", JSON.stringify({ type: "line", data: [] })))).toEqual([]);
  });

  it("與圖表無關的訊息不影響結果", () => {
    const extract = createChartExtractor();

    expect(extract({ type: "system", subtype: "init", session_id: "s-1" })).toEqual([]);
    expect(extract({ type: "stream_event", event: { type: "content_block_delta" } })).toEqual([]);
  });
});

// 圖表定義的擷取以 schema 驗證為輔；新增的 union 分支須確實被那份 schema 認得。
describe("createChartExtractor 雷達圖", () => {
  it("取出 radar tool 回傳的圖表定義", () => {
    const extract = createChartExtractor();
    const radar = {
      type: "radar" as const,
      data: [{ aspect: "服務", 北店: 80 }],
      angleKey: "aspect",
      series: [{ key: "北店" }],
    };

    extract(toolUse("t-1", "mcp__charts__radar_chart"));
    expect(extract(toolResult("t-1", JSON.stringify(radar)))).toEqual([radar]);
  });
});

// 圖表定義的擷取以 schema 驗證為輔；新增的 union 分支須確實被那份 schema 認得。
describe("createChartExtractor 散佈圖", () => {
  it("取出 scatter tool 回傳的圖表定義，含氣泡欄位", () => {
    const extract = createChartExtractor();
    const scatter = {
      type: "scatter" as const,
      data: [{ price: 10, sales: 400, profit: 5 }],
      xKey: "price",
      series: [{ key: "sales" }],
      sizeKey: "profit",
      range: [4, 20] as [number, number],
    };

    extract(toolUse("t-1", "mcp__charts__scatter_chart"));
    expect(extract(toolResult("t-1", JSON.stringify(scatter)))).toEqual([scatter]);
  });
});
