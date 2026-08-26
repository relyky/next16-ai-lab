"use client";

/**
 * 工具呼叫歷程列：顯示 LLM 在該則回應中呼叫了哪些工具、各自進行到哪。
 *
 * 只顯示名稱與狀態——不含呼叫參數，也不含回傳內容。目的是讓使用者
 * 大致了解處理過程，而非提供除錯用的完整 trace。
 * 名稱以原始全名呈現（如 `mcp__charts__bar_chart`），不做前綴剝除或美化。
 */
import { Check, Loader2, X } from "lucide-react";

export type ToolUsage = {
  /** 工具呼叫識別碼，用來把結束事件對回這一列。 */
  id: string;
  /** 工具全名。 */
  name: string;
  status: "running" | "success" | "error";
  /** 失敗時的截斷後簡短原因。 */
  message?: string;
};

function StatusIcon({ status }: { status: ToolUsage["status"] }) {
  if (status === "running") {
    return (
      <Loader2
        data-slot="tool-usage-spinner"
        aria-label="進行中"
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
      />
    );
  }
  if (status === "success") {
    return (
      <Check
        data-slot="tool-usage-success"
        aria-label="成功"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  }
  return (
    <X
      data-slot="tool-usage-error"
      aria-label="失敗"
      className="size-3.5 shrink-0 text-destructive"
    />
  );
}

export function ToolUsageList({ usages }: { usages: ToolUsage[] }) {
  return (
    <ul
      data-slot="tool-usage-list"
      className="flex flex-col gap-1 border-b px-4 py-2"
    >
      {usages.map((usage) => (
        <li
          key={usage.id}
          data-slot="tool-usage"
          data-status={usage.status}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <StatusIcon status={usage.status} />
          <span className="font-mono break-all">{usage.name}</span>
          {usage.message ? (
            <span className="text-destructive">{usage.message}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
