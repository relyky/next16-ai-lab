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
  it("列出四個 tool", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["area_chart", "bar_chart", "line_chart", "pie_chart"]);
  });

  it.each([["bar_chart", "bar"], ["area_chart", "area"]])(
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
