"use client";

import { useRef, useState } from "react";

import { AssistantMarkdown } from "@/components/assistant-markdown";
import { ChartCard } from "@/components/chart-card";
import { ChatInput } from "@/components/chat-input";
import { ToolUsageList, type ToolUsage } from "@/components/tool-usage-list";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ChartDefinition } from "@/lib/charts/chart-tool";
import type { ChatStreamEvent, Usage } from "@/lib/chat-stream";

type Message = {
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

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl bg-primary px-4 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  text,
  notice,
  charts,
  toolUsages,
  isAnimating,
}: {
  text: string;
  notice?: string;
  charts?: ChartDefinition[];
  toolUsages?: ToolUsage[];
  /** 只有正在串流的那一則為 true；歷史訊息不該跟著重播淡入。 */
  isAnimating?: boolean;
}) {
  // 泡泡、圖表、提示是同一則回應的三種產物，但各自有自己的外框。圖表放進
  // 泡泡裡會變成 bg-card 疊 bg-card 的雙層框，內框沒有對比、只剩雜訊；故三者
  // 並列為兄弟，以 assistant-turn 綁在一起，保證不會與別則混淆。
  // 圖表可能比文字先到，此時整個泡泡都還沒有內容，就不要留一個空框。
  const hasBubble = Boolean(toolUsages?.length || text);

  return (
    <div
      data-slot="assistant-turn"
      // 一則回應的三種產物（泡泡／圖表／提示）以一層淡底色收成一群。
      // 深色模式不能沿用 muted：本專案的 --card(0.205) 比 --background(0.145) 亮，
      // 卡片是浮起的；muted(0.269) 當底色會比卡片還亮而讓卡片凹陷、深度線索反轉。
      // 故深色改用比 card 更暗的黑色薄層，兩種模式下卡片都比群組底色亮。
      className="flex flex-col items-start gap-2 rounded-xl bg-muted/60 p-3 dark:bg-black/25"
    >
      {hasBubble ? (
        <Card data-slot="assistant-message" className="max-w-[90%] p-0">
          {/* 工具列在文字之前，反映「先呼叫工具、再依結果作答」的實際流程。 */}
          {toolUsages?.length ? <ToolUsageList usages={toolUsages} /> : null}
          {text ? (
            <AssistantMarkdown text={text} isAnimating={isAnimating} />
          ) : null}
        </Card>
      ) : null}

      {/* ResponsiveContainer 量的是父層的實際寬度；w-full 是必要的而非裝飾——
          items-start 會讓子項隨內容縮放，量不到寬度圖就畫不出來。 */}
      {charts?.length ? (
        <div data-slot="assistant-charts" className="flex w-full flex-col gap-3">
          {charts.map((chart, index) => (
            // 圖表沒有天然的識別碼，同一則回應中的順序即其身分。
            <ChartCard key={index} chart={chart} />
          ))}
        </div>
      ) : null}

      {/* 提示排在所有內容之後：使用者要在讀完已浮現的內容後才看到「已中斷」。
          它不在泡泡內，故未閉合的程式碼圍欄不可能把它吞進程式碼區塊。 */}
      {notice ? (
        <p data-slot="assistant-notice" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

const ZERO_USAGE: Usage = { in: 0, cache_c: 0, cache_r: 0, out: 0 };

/** 本輪 session 的累計用量；四項分開顯示，不做總和（理由見 Usage 型別）。 */
function UsageLine({ usage }: { usage: Usage }) {
  const format = (n: number) => n.toLocaleString();
  return (
    <p className="pt-2 text-xs text-muted-foreground">
      {`累計消耗 in ${format(usage.in)} | cache_c ${format(usage.cache_c)}` +
        ` | cache_r ${format(usage.cache_r)} | out ${format(usage.out)} tokens`}
    </p>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 累加在前端做：後端每次請求各自呼叫 query()、維持無狀態，前端才是
  // 「這一輪 session」的邊界持有者。null 代表尚無任何用量，不渲染該行。
  // sessionId 變更（resume 有可能 fork）不歸零：使用者看到的是同一個對話。
  const [usage, setUsage] = useState<Usage | null>(null);
  // 純顯示濾鏡：關閉期間歷程照常收集，重新打開後完整可見。刻意不做持久化。
  const [showToolUsages, setShowToolUsages] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(text: string) {
    const userMessageId = messages.length;
    const assistantMessageId = userMessageId + 1;
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: "user", text },
    ]);
    setLoading(true);

    // 助手訊息泡泡在第一個事件到達時才建立，之後就地更新。
    // 文字與圖表各自到達，故以「要改哪些欄位」為單位更新同一則訊息。
    const upsertReply = (patch: Partial<Omit<Message, "id" | "role">>) =>
      setMessages((prev) =>
        prev.some((m) => m.id === assistantMessageId)
          ? prev.map((m) =>
              m.id === assistantMessageId ? { ...m, ...patch } : m
            )
          : [
              ...prev,
              { id: assistantMessageId, role: "assistant", text: "", ...patch },
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
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, sessionId: sessionId ?? undefined }),
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
          setSessionId(event.sessionId);
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
          setUsage((prev) => {
            const base = prev ?? ZERO_USAGE;
            return {
              in: base.in + event.in,
              cache_c: base.cache_c + event.cache_c,
              cache_r: base.cache_r + event.cache_r,
              out: base.out + event.out,
            };
          });
        } else if (event.type === "done") {
          setSessionId(event.sessionId);
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
      abortRef.current = null;
      setLoading(false);
    }
  }

  // loading 是頁面層級的單一布林；直接傳給每一則助手訊息的話，串流期間
  // 畫面上所有歷史助手訊息都會收到「正在動畫」而重播淡入——使用者每問一個
  // 新問題，整段對話歷史就會閃動一次。故渲染前先取得最後一則助手訊息的
  // 識別碼，只有它在串流期間才啟用動畫。
  const lastAssistantId = messages.findLast((m) => m.role === "assistant")?.id;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <label className="flex items-center gap-2 self-end pt-4 text-sm text-muted-foreground">
        {/* base-ui 的 onCheckedChange 還帶第二個參數，顯式接第一個才不會誤傳。 */}
        <Switch
          checked={showToolUsages}
          onCheckedChange={(checked) => setShowToolUsages(checked)}
        />
        顯示處理過程
      </label>

      <div className="flex flex-1 flex-col gap-4 py-8">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            輸入你的財務問題，開始與財務助手對話。
          </p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <UserMessage key={message.id} text={message.text} />
          ) : (
            <AssistantMessage
              key={message.id}
              text={message.text}
              notice={message.notice}
              charts={message.charts}
              toolUsages={showToolUsages ? message.toolUsages : undefined}
              isAnimating={loading && message.id === lastAssistantId}
            />
          )
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">財務助手思考中……</p>
        )}
      </div>

      {/* 用量列與輸入列同屬一個 sticky 區塊，捲動時一起釘在底部。 */}
      <div className="sticky bottom-0 border-t bg-background">
        {usage && <UsageLine usage={usage} />}
        <ChatInput
          onSubmit={handleSubmit}
          onAbort={() => abortRef.current?.abort()}
          disabled={loading}
        />
      </div>
    </div>
  );
}
