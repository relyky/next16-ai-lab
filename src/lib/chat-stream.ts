import type { ChartDefinition } from "@/lib/charts/chart-tool";

/** `/api/chat` 的 NDJSON 串流協定：每行一個事件，前後端共用。 */
export type ChatStreamEvent =
  /** 本次對話的 session id，串流一開始就送出（中斷時也已取得，可用於接續） */
  | { type: "session"; sessionId: string }
  /** 逐字增量 */
  | { type: "delta"; text: string }
  /** charts tool 產生的圖表定義，依產生順序送出，前端接在目前文字之後渲染 */
  | { type: "chart"; chart: ChartDefinition }
  /** 權威的完整內容（串流正常結束） */
  | { type: "done"; result: string; sessionId: string }
  /** 串流開始後才發生的失敗 */
  | { type: "error"; error: string };
