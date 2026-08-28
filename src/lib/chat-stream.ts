import type { ChartDefinition } from "@/lib/charts/chart-tool";

/**
 * 四種 token 分類，見 CONTEXT.md。三種輸入分類互斥（`in` 不含 cache 部分），
 * 故一律分開呈現、不做總和 —— 四者計價不同，相加在財務意義上會誤導。
 */
export type Usage = {
  in: number;
  cache_c: number;
  cache_r: number;
  out: number;
};

/** `/api/chat` 的 NDJSON 串流協定：每行一個事件，前後端共用。 */
export type ChatStreamEvent =
  /**
   * 本次對話的 session id 與所用模型，串流一開始就送出
   * （中斷時也已取得，可用於接續）。
   * `model` 隨事件帶出而非走 `NEXT_PUBLIC_` 環境變數：伺服器設定不外洩到
   * client bundle，前端仍拿得到要顯示的值。整輪不變，故 `done` 不重送。
   */
  | { type: "session"; sessionId: string; model: string }
  /** 逐字增量 */
  | { type: "delta"; text: string }
  /** charts tool 產生的圖表定義，依產生順序送出，前端接在目前文字之後渲染 */
  | { type: "chart"; chart: ChartDefinition }
  /** LLM 發出一次工具呼叫；`name` 為工具全名，不做前綴剝除或美化 */
  | { type: "tool_use"; id: string; name: string }
  /** 該次工具呼叫結束；成功時純為結束訊號，失敗時 `message` 帶截斷後的簡短原因 */
  | { type: "tool_done"; id: string; ok: boolean; message?: string }
  /**
   * 本輪 `query()` 的 token 用量，跨各模型加總。
   * 不分成敗，只要該輪有結果就送出 —— 失敗輪次（turn 用盡、API 過載等）
   * 的 token 一樣真的消耗了。排在 `done` 與 `error` 之前：前端一收到
   * `error` 就中止解析該次串流，排在後面會被漏接。
   * 中斷的輪次仍不會有此事件 —— 那時後端拿不到用量。
   */
  | ({ type: "usage" } & Usage)
  /** 權威的完整內容（串流正常結束） */
  | { type: "done"; result: string; sessionId: string }
  /** 串流開始後才發生的失敗 */
  | { type: "error"; error: string };
