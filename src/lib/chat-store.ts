"use client";

import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";

import type { ChartDefinition } from "@/lib/charts/chart-tool";
import type { ChatStreamEvent, Usage } from "@/lib/chat-stream";
import type { ToolUsage } from "@/components/tool-usage-list";

export type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /**
   * 中斷或失敗的提示；只有 assistant 會有。
   * 刻意與 text 分開：串接進回覆文字的話，回覆一旦改以 markdown 渲染，
   * 停在未閉合程式碼圍欄的輸出會把提示一起吞進程式碼區塊裡。
   */
  notice?: string;
  /** 本則回應中助手產生的圖表，依產生順序排列；只有 assistant 會有。 */
  charts?: ChartDefinition[];
  /** 本則回應中的工具呼叫歷程，依呼叫順序排列；只有 assistant 會有。 */
  toolUsages?: ToolUsage[];
};

export const ZERO_USAGE: Usage = { in: 0, cache_c: 0, cache_r: 0, out: 0 };

/**
 * 對話狀態住在 jotai 的預設 store，而非元件內。
 *
 * 預設 store 是 module-scope 的 singleton，生命週期正好是「一個分頁」：
 * 切換頁面不重建（元件卸載不影響 store），重新整理才歸零——這正是
 * 「切頁後可續談、F5 即清空」所要的邊界。故不包 Provider。
 */
export const messagesAtom = atom<Message[]>([]);
export const sessionIdAtom = atom<string | null>(null);
/**
 * 模型由後端隨 session 事件帶到（設定不進 client bundle）。整輪不變，
 * 與 sessionId 同樣不歸零：使用者看到的是同一個對話。
 */
export const modelAtom = atom<string | null>(null);
/**
 * 串流中與否。與串流同層（store）而非留在頁面：留在頁面的話，串流中切走
 * 再切回會得到全新的 false，使用者可再送一則，兩個串流同時寫訊息陣列，
 * 且 abort controller 被後者覆寫——前一個永久洩漏、再也無法中斷。
 */
export const loadingAtom = atom(false);
/**
 * 累加在前端做：後端每次請求各自呼叫 query()、維持無狀態，前端才是
 * 「這一輪 session」的邊界持有者。null 代表尚無任何用量，不渲染該行。
 * sessionId 變更（resume 有可能 fork）不歸零：使用者看到的是同一個對話。
 */
export const usageAtom = atom<Usage | null>(null);

/**
 * message id 取號器。
 *
 * 刻意不由 messages 長度推算：那只在「每輪恰好新增兩則」成立時才對，
 * 且從渲染閉包讀取陣列——送出邏輯離開元件後，閉包裡的陣列不再更新，
 * 每輪都會算出同樣的 id，造成 key 重複並讓就地更新命中上一輪的舊訊息。
 */
let nextMessageId = 0;
export const takeMessageId = () => nextMessageId++;

/**
 * 進行中串流的 abort controller。
 *
 * 不做成 atom：它不是渲染會用到的值，沒有任何元件需要因它變動而重繪，
 * 放進 atom 只會多一層無意義的訂閱。
 */
let abortController: AbortController | null = null;
export const setAbortController = (controller: AbortController | null) => {
  abortController = controller;
};
export const abortStream = () => abortController?.abort();

/**
 * 送出一則提問並處理整段串流回應。
 *
 * write-only atom：邏輯住在 store 而非元件，故元件卸載（切換頁面）不會
 * 打斷它——串流照常寫進 atom，使用者切回來看到的是繼續增長或已完成的回覆。
 *
 * 刻意不做任何卸載時的 cleanup：切頁中止串流會讓使用者切回來看到一則
 * 沒人按過中斷鈕的「（已中斷）」，那是在說謊；而且中止前端請求不必然
 * 停下伺服器端的生成，token 大概率照樣消耗，中止只是主動放棄已付費的
 * 結果。這是刻意的決定，不是漏掉的 cleanup。
 */
export const submitPromptAtom = atom(null, async (get, set, text: string) => {
  // 防重入。現況的送出鈕與 loading 同在一個元件裡、不可能不同步，但狀態
  // 提升後這個保證消失（切頁往返是新的入口）：兩個串流同時寫訊息陣列時，
  // abort controller 會被後者覆寫而讓前一個永久洩漏。這是最後一道防線。
  if (get(loadingAtom)) return;

  const userMessageId = takeMessageId();
  const assistantMessageId = takeMessageId();
  set(messagesAtom, (prev) => [
    ...prev,
    { id: userMessageId, role: "user" as const, text },
  ]);
  set(loadingAtom, true);

  // 助手訊息泡泡在第一個事件到達時才建立，之後就地更新。
  // 文字與圖表各自到達，故以「要改哪些欄位」為單位更新同一則訊息。
  const upsertReply = (patch: Partial<Omit<Message, "id" | "role">>) =>
    set(messagesAtom, (prev) =>
      prev.some((m) => m.id === assistantMessageId)
        ? prev.map((m) =>
            m.id === assistantMessageId ? { ...m, ...patch } : m
          )
        : [
            ...prev,
            { id: assistantMessageId, role: "assistant" as const, text: "", ...patch },
          ]
    );

  let accumulated = "";
  // 圖表事件不會重送，累積在本地才能與文字更新一起送進同一則訊息。
  const charts: ChartDefinition[] = [];
  // 工具事件同理；狀態轉換需要能依 id 找回既有那一列。
  // 每次更新都換成新陣列與新物件，不改動已交給 React 的既有值。
  let toolUsages: ToolUsage[] = [];
  const pushToolUsages = () => upsertReply({ toolUsages });
  /** 串流結束時把仍在進行中的工具收成終態，畫面不留下永遠轉圈的指示器。 */
  const settlePendingTools = (message: string) => {
    if (!toolUsages.some((u) => u.status === "running")) return;
    toolUsages = toolUsages.map((usage) =>
      usage.status === "running"
        ? { ...usage, status: "error" as const, message }
        : usage
    );
    pushToolUsages();
  };
  const controller = new AbortController();
  setAbortController(controller);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 從 store 取當下值，而非閉包：跨輪之間 sessionId 會被 session／done
      // 事件更新，讀閉包會拿到這一輪開始時的舊值。
      body: JSON.stringify({ prompt: text, sessionId: get(sessionIdAtom) ?? undefined }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 串流尚未開始的錯誤（如格式驗證）仍是 JSON；解析失敗不該蓋掉真正的錯誤原因。
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? `請求失敗（HTTP ${res.status}）`);
    }
    if (!res.body) {
      throw new Error("回應格式錯誤");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let handledAny = false;

    const handleLine = (line: string) => {
      if (!line.trim()) return;

      let event: ChatStreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        // 無法解析代表內容已經不完整，不能靜默吞掉。
        throw new Error("回應格式錯誤");
      }
      if (event.type === "session") {
        // 中斷時不會有 done，先記住 session id 才能接續下一則訊息。
        // session 不是回覆內容，單獨收到它不足以視為有效回應。
        set(sessionIdAtom, event.sessionId);
        set(modelAtom, event.model);
        return;
      }
      handledAny = true;

      if (event.type === "delta") {
        accumulated += event.text;
        upsertReply({ text: accumulated });
      } else if (event.type === "chart") {
        charts.push(event.chart);
        upsertReply({ charts: [...charts] });
      } else if (event.type === "tool_use") {
        toolUsages = [
          ...toolUsages,
          { id: event.id, name: event.name, status: "running" },
        ];
        pushToolUsages();
      } else if (event.type === "tool_done") {
        // 沒有對應的 tool_use 就無列可更新；後端已濾掉孤兒，此處僅為防禦。
        if (!toolUsages.some((u) => u.id === event.id)) return;
        toolUsages = toolUsages.map((u) =>
          u.id === event.id
            ? {
                ...u,
                status: event.ok ? ("success" as const) : ("error" as const),
                message: event.ok ? undefined : event.message,
              }
            : u
        );
        pushToolUsages();
      } else if (event.type === "usage") {
        set(usageAtom, (prev) => {
          const base = prev ?? ZERO_USAGE;
          return {
            in: base.in + event.in,
            cache_c: base.cache_c + event.cache_c,
            cache_r: base.cache_r + event.cache_r,
            out: base.out + event.out,
          };
        });
      } else if (event.type === "done") {
        set(sessionIdAtom, event.sessionId);
        // 最終完整訊息為權威內容；若為空則保留已累積的增量。
        if (event.result) {
          accumulated = event.result;
          upsertReply({ text: accumulated });
        }
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // 最後一段可能是被切斷的半行。
      for (const line of lines) handleLine(line);
    }
    handleLine(buffer + decoder.decode()); // decode() 收尾未完成的多位元組字元。

    if (!handledAny) {
      throw new Error("回應格式錯誤");
    }

    // 串流正常結束時仍可能有工具沒等到結果（工具權限被拒、turn 用盡等）。
    // 不收尾的話，一則「成功」的回應上會留著永遠轉圈的指示器。
    settlePendingTools("未完成");
  } catch (err) {
    // 使用者主動中斷不是失敗：保留已浮現的內容，只加註標示。
    if (err instanceof DOMException && err.name === "AbortError") {
      settlePendingTools("已中斷");
      upsertReply({ notice: "（已中斷）" });
      return;
    }

    const reason = err instanceof Error ? err.message : "未知錯誤";
    settlePendingTools("未完成");
    // 已浮現的內容原封不動保留，錯誤提示走自己的欄位。
    upsertReply({
      notice: `抱歉，這次回覆失敗了：${reason}。請再試一次。`,
    });
  } finally {
    setAbortController(null);
    set(loadingAtom, false);
  }
});

/**
 * 具名的「atom／初始值」清單，供 reset 迭代。
 * 列成清單而非散在 reset 內，是為了讓「新增了 atom 卻忘記 reset」
 * 變成看得見的疏漏，而不是只在特定測試執行順序下重現的偶發污染。
 */
const RESETTABLE_ATOMS: { name: string; atom: PrimitiveAtom<never>; initial: unknown }[] = [
  { name: "messages", atom: messagesAtom as never, initial: [] },
  { name: "sessionId", atom: sessionIdAtom as never, initial: null },
  { name: "model", atom: modelAtom as never, initial: null },
  { name: "loading", atom: loadingAtom as never, initial: false },
  { name: "usage", atom: usageAtom as never, initial: null },
];

/**
 * 僅供測試使用。
 *
 * atom 的值住在 module-scope 的 store，元件卸載不會重置它，故測試無法
 * 只靠 RTL 的 cleanup 取得乾淨狀態——上一個測試的訊息與 sessionId 會殘留。
 * message id 計數器與 abort controller 同樣是 module-scope，一併歸零。
 */
export function resetChatStoreForTest() {
  const store = getDefaultStore();
  for (const { atom: a, initial } of RESETTABLE_ATOMS) {
    store.set(a, initial as never);
  }
  nextMessageId = 0;
  abortController = null;
}
