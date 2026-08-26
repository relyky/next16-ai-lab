/**
 * SDK 訊息 content block 的共用讀取輔助。
 *
 * 圖表擷取器與工具擷取器都要從 assistant / user 訊息裡撈 content block，
 * 兩者對 block 的形狀與 tool_result content 的攤平方式需求相同，故收在此處。
 * 欄位一律以 unknown 收下，由各擷取器自行收窄——訊息來自 SDK，形狀不由我們保證。
 */
export type ContentBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  text?: unknown;
  is_error?: unknown;
};

export function contentBlocks(message: unknown): ContentBlock[] {
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

/**
 * tool_result 的 content 可能是純字串，也可能是 content block 陣列。
 * 兩種形式都攤平成單一字串，交給呼叫端判讀。
 */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("");
}
