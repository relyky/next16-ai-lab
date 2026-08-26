/**
 * 從 LLM 訊息流中挑出工具呼叫的開始與結束，供前端顯示處理過程。
 *
 * 與圖表擷取器（@/lib/charts/chart-extract）對稱：tool_result 只帶
 * `tool_use_id`、不帶工具名稱，因此必須先記下已發出的 tool_use，
 * 結果到達時才對得起來。
 *
 * 擷取來源刻意是完整的 assistant / user 訊息，而非 stream_event 的逐字增量：
 * assistant 訊息在 content block 完成後才送達，已含 tool_use 的 id 與 name；
 * 逐字增量只會給出破碎的中間狀態，而我們不顯示參數，也就不需要它們。
 */
import type { ChatStreamEvent } from "@/lib/chat-stream";
import { contentBlocks, resultText } from "@/lib/message-blocks";

/** 失敗訊息只是給人看的處理過程提示，不是除錯輸出，故截短。 */
const MESSAGE_MAX_LENGTH = 100;

/** 取前 MESSAGE_MAX_LENGTH 字；先去頭尾空白，長度才是實際內容的長度。 */
function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MESSAGE_MAX_LENGTH
    ? `${trimmed.slice(0, MESSAGE_MAX_LENGTH)}…`
    : trimmed;
}

/**
 * 建立一個有狀態的擷取器：依序餵入訊息，回傳該則訊息帶出的工具事件。
 *
 * 狀態即「已發出但尚未結束的 tool_use id」，因此一次對話要用同一個擷取器。
 */
export function createToolExtractor() {
  const pendingToolUseIds = new Set<string>();

  return function extractToolEvents(message: unknown): ChatStreamEvent[] {
    const type = (message as { type?: unknown })?.type;

    if (type === "assistant") {
      const events: ChatStreamEvent[] = [];
      for (const block of contentBlocks(message)) {
        if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          pendingToolUseIds.add(block.id);
          events.push({ type: "tool_use", id: block.id, name: block.name });
        }
      }
      return events;
    }

    if (type !== "user") return [];

    const events: ChatStreamEvent[] = [];
    for (const block of contentBlocks(message)) {
      if (block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;
      // 孤兒 tool_result（無對應 tool_use）忽略：沒有可對應的顯示列。
      if (!pendingToolUseIds.delete(block.tool_use_id)) continue;

      if (block.is_error === true) {
        events.push({
          type: "tool_done",
          id: block.tool_use_id,
          ok: false,
          message: truncate(resultText(block.content)),
        });
      } else {
        events.push({ type: "tool_done", id: block.tool_use_id, ok: true });
      }
    }
    return events;
  };
}
