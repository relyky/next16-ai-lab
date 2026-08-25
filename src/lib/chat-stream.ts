/** `/api/chat` 的 NDJSON 串流協定：每行一個事件，前後端共用。 */
export type ChatStreamEvent =
  /** 逐字增量 */
  | { type: "delta"; text: string }
  /** 權威的完整內容（串流正常結束） */
  | { type: "done"; result: string; sessionId: string }
  /** 串流開始後才發生的失敗 */
  | { type: "error"; error: string };
