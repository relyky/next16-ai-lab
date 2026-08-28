"use client";

import { useMemo, useState } from "react";

import { useAtomValue, useSetAtom } from "jotai";
import { Bot, Hash } from "lucide-react";

import { AssistantMarkdown } from "@/components/assistant-markdown";
import { ChartCard, ChartPaletteProvider } from "@/components/chart-card";
import { ChatInput } from "@/components/chat-input";
import { ToolUsageList, type ToolUsage } from "@/components/tool-usage-list";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ChartDefinition } from "@/lib/charts/chart-tool";
import {
  abortStream,
  loadingAtom,
  messagesAtom,
  modelAtom,
  sessionIdAtom,
  submitPromptAtom,
  usageAtom,
} from "@/lib/chat-store";
import type { Usage } from "@/lib/chat-stream";

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

/**
 * 工具列左側的唯讀狀態：本輪所用的模型與 session 識別碼。
 *
 * 兩者都在第一輪串流開始時才由 session 事件帶到，此前整項不渲染
 * —— 沿用用量列的慣例：沒有值就沒有這個節點，而非顯示佔位符。
 */
function SessionInfo({
  model,
  sessionId,
}: {
  model: string | null;
  sessionId: string | null;
}) {
  if (!model && !sessionId) return null;

  return (
    <div
      data-slot="session-info"
      // min-w-0 讓這一側成為被壓縮的一方，sessionId 才有得截斷。
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
    >
      {model ? (
        <span className="flex shrink-0 items-center gap-1">
          <Bot className="size-3.5 shrink-0" aria-hidden />
          <span className="font-mono">{model}</span>
        </span>
      ) : null}
      {model && sessionId ? <span className="shrink-0">|</span> : null}
      {sessionId ? (
        <span className="flex min-w-0 items-center gap-1">
          <Hash className="size-3.5 shrink-0" aria-hidden />
          {/* 完整顯示以便對日誌；寬度不足時尾端省略。 */}
          <span className="truncate font-mono">{sessionId}</span>
        </span>
      ) : null}
    </div>
  );
}

export default function ChatPage() {
  // 對話狀態住在 store 而非元件：切換到別的頁面再切回來，看到的是原本那段
  // 對話。重新整理或關閉分頁才歸零——store 純粹在記憶體。
  const messages = useAtomValue(messagesAtom);
  const sessionId = useAtomValue(sessionIdAtom);
  const model = useAtomValue(modelAtom);
  const loading = useAtomValue(loadingAtom);
  const usage = useAtomValue(usageAtom);
  const submitPrompt = useSetAtom(submitPromptAtom);
  // 純顯示濾鏡：關閉期間歷程照常收集，重新打開後完整可見。刻意不做持久化，
  // 故不隨對話狀態提升到 store——它不是對話的一部分，是「我現在想不想看」。
  const [showToolUsages, setShowToolUsages] = useState(false);

  // loading 是頁面層級的單一布林；直接傳給每一則助手訊息的話，串流期間
  // 畫面上所有歷史助手訊息都會收到「正在動畫」而重播淡入——使用者每問一個
  // 新問題，整段對話歷史就會閃動一次。故渲染前先取得最後一則助手訊息的
  // 識別碼，只有它在串流期間才啟用動畫。
  const lastAssistantId = messages.findLast((m) => m.role === "assistant")?.id;

  // 配色對照表的輸入：所有訊息的所有圖表，依實際產生順序攤平。
  // 這是 messages 的衍生值而非另一份狀態，串流過程中重複 render 也不會讓色序漂移。
  const allCharts = useMemo(
    () => messages.flatMap((m) => m.charts ?? []),
    [messages]
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      {/* 左側為唯讀狀態、右側為開關；狀態不存在時開關仍靠右不移位。 */}
      <div className="flex items-center justify-between gap-4 pt-4">
        <SessionInfo model={model} sessionId={sessionId} />
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          {/* base-ui 的 onCheckedChange 還帶第二個參數，顯式接第一個才不會誤傳。 */}
          <Switch
            checked={showToolUsages}
            onCheckedChange={(checked) => setShowToolUsages(checked)}
          />
          顯示處理過程
        </label>
      </div>

      <div className="flex flex-1 flex-col gap-4 py-8">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            輸入你的財務問題，開始與財務助手對話。
          </p>
        )}
        {/* 對照表涵蓋整個對話：同一個類別名稱在所有訊息的所有圖表裡同色。 */}
        <ChartPaletteProvider charts={allCharts}>
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
        </ChartPaletteProvider>
        {loading && (
          <p className="text-sm text-muted-foreground">財務助手思考中……</p>
        )}
      </div>

      {/* 用量列與輸入列同屬一個 sticky 區塊，捲動時一起釘在底部。 */}
      <div className="sticky bottom-0 border-t bg-background">
        {usage && <UsageLine usage={usage} />}
        <ChatInput
          onSubmit={submitPrompt}
          onAbort={abortStream}
          disabled={loading}
        />
      </div>
    </div>
  );
}
