// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createChartsMcpServer } from "./charts-mcp-server";

const args = {
  data: [{ month: "1月", revenue: 120 }, { month: "2月", revenue: 150 }],
  xKey: "month",
  series: [{ key: "revenue" }],
};

async function connect() {
  const created = createChartsMcpServer() as unknown as { instance: unknown };
  const server = created.instance as { connect: (t: unknown) => Promise<void> };
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

/**
 * 經真實 MCP client 走完整協定往返，驗證 tool 確實「可被呼叫」。
 *
 * 其餘測試直接呼叫 handler，驗的是轉換邏輯；這裡驗的是註冊與協定層，
 * 兩者互補——handler 對了但沒註冊成功，只有這支測得出來。
 */
describe("charts MCP server 經真實 MCP client 呼叫", () => {
  it("列出六個 tool", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "area_chart",
      "bar_chart",
      "line_chart",
      "pie_chart",
      "radar_chart",
      "scatter_chart",
    ]);
  });

  /**
   * 雷達圖的角度軸叫 angleKey 而非 xKey——這條契約對 LLM 唯一可見的落點
   * 是 inputSchema，只有走完整協定拿得到。
   */
  it("radar_chart 的 inputSchema 含 angleKey 且不含 xKey", async () => {
    const client = await connect();
    const found = (await client.listTools()).tools.find((t) => t.name === "radar_chart");

    expect(found?.inputSchema.properties).toHaveProperty("angleKey");
    expect(found?.inputSchema.properties).not.toHaveProperty("xKey");
  });

  it("radar_chart 回傳 type 為 radar 的圖表定義 JSON", async () => {
    const client = await connect();
    const radarArgs = {
      data: [
        { aspect: "服務", 北店: 80 },
        { aspect: "價格", 北店: 60 },
      ],
      angleKey: "aspect",
      series: [{ key: "北店" }],
    };
    const r = (await client.callTool({
      name: "radar_chart",
      arguments: radarArgs,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toEqual({ type: "radar", ...radarArgs });
  });

  /**
   * stacked 是否出現在 tool 簽章上，只有走完整協定拿到 inputSchema 才驗得到。
   * 這是「line_chart 不接受 stacked」這條規則對 LLM 唯一可見的落點。
   */
  it("line_chart 的 inputSchema 不含 stacked，bar/area 含之且型別為布林", async () => {
    const client = await connect();
    const byName = new Map(
      (await client.listTools()).tools.map((t) => [t.name, t.inputSchema])
    );

    expect(byName.get("line_chart")?.properties).not.toHaveProperty("stacked");
    for (const name of ["bar_chart", "area_chart"]) {
      const properties = byName.get(name)?.properties as
        | Record<string, { type?: string }>
        | undefined;
      expect(properties?.stacked?.type).toBe("boolean");
    }
  });

  // stacked 未在 schema 層設預設值，JSON Schema 因此不帶 default，
  // 各自的預設只能寫在描述裡；缺了 LLM 就無從得知要顯式傳值。
  it.each([
    ["bar_chart", "並排"],
    ["area_chart", "堆疊"],
  ])("%s 的描述明文寫出 stacked 的預設", async (name, expected) => {
    const client = await connect();
    const found = (await client.listTools()).tools.find((t) => t.name === name);

    expect(found?.description).toContain("預設" + expected);
  });

  it.each([["bar_chart", "bar"], ["area_chart", "area"], ["line_chart", "line"]])(
    "%s 回傳正確 type 的圖表定義 JSON",
    async (name, type) => {
      const client = await connect();
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean; content: { text: string }[];
      };
      expect(r.isError).toBeFalsy();
      expect(JSON.parse(r.content[0].text)).toEqual({ type, ...args });
    }
  );

  /**
   * MCP SDK 在註冊層以 `z.object(shape)`（非 strict）先 parse 一次，
   * 未知欄位在抵達我們的 handler 前就已被剝除，因此協定層看到的是
   * 「靜默忽略」而非錯誤——這是 SDK 的行為，不是我們能在 schema 上改變的。
   *
   * 我們的 shape 仍維持 strict：那是這些 tool 的誠實契約，
   * 也擋得住直接呼叫轉換函式的路徑（見 chart-tool.test.ts）。
   */
  it.each(["line_chart", "bar_chart", "area_chart"])(
    "%s 的未知欄位由 SDK 於註冊層剝除，不進入圖表定義",
    async (name) => {
      const client = await connect();
      const r = (await client.callTool({
        name, arguments: { ...args, bogus: true },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(r.isError).toBeFalsy();
      expect(JSON.parse(r.content[0].text)).not.toHaveProperty("bogus");
    }
  );

  it.each(["bar_chart", "area_chart"])("%s 錯誤情境回傳 isError", async (name) => {
    const client = await connect();
    const r = (await client.callTool({
      name, arguments: { ...args, xKey: "quarter" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content.map((c) => c.text).join()).toContain("quarter");
  });
});

/**
 * 氣泡能力對 LLM 唯一可見的落點就是 inputSchema——只有走完整協定拿到它才驗得到。
 * schema 少了 sizeKey 或 range，氣泡大小就等於不存在。
 */
describe("scatter_chart 經真實 MCP client 呼叫", () => {
  it("inputSchema 含 sizeKey 與 range", async () => {
    const client = await connect();
    const found = (await client.listTools()).tools.find((t) => t.name === "scatter_chart");
    const properties = found?.inputSchema.properties as
      | Record<string, unknown>
      | undefined;

    expect(properties).toHaveProperty("sizeKey");
    expect(properties).toHaveProperty("range");
    expect(properties).toHaveProperty("xKey");
  });

  it("回傳 type 為 scatter 的圖表定義 JSON，含氣泡欄位", async () => {
    const client = await connect();
    const scatterArgs = {
      data: [
        { price: 10, sales: 400, profit: 5 },
        { price: 20, sales: 250, profit: 50 },
      ],
      xKey: "price",
      series: [{ key: "sales" }],
      sizeKey: "profit",
      range: [4, 20],
    };
    const r = (await client.callTool({
      name: "scatter_chart",
      arguments: scatterArgs,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toEqual({ type: "scatter", ...scatterArgs });
  });

  it("錯誤情境回傳 isError", async () => {
    const client = await connect();
    const r = (await client.callTool({
      name: "scatter_chart",
      arguments: {
        data: [{ price: 10, sales: 400 }],
        xKey: "cost",
        series: [{ key: "sales" }],
      },
    })) as { isError?: boolean; content: { text: string }[] };

    expect(r.isError).toBe(true);
    expect(r.content.map((c) => c.text).join()).toContain("cost");
  });
});
