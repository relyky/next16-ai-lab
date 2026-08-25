"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({
  onSubmit,
  onAbort,
  disabled = false,
}: {
  onSubmit?: (text: string) => void;
  /** disabled 代表回覆串流中，此時送出鈕改為「中斷」。 */
  onAbort: () => void;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  function handleInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = event.target;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    setText(textarea.value);
  }

  function handleSubmit() {
    if (disabled || !text.trim()) return;
    onSubmit?.(text.trim());
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 輸入法組字中的 Enter 是選字，不能當作送出。
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="sticky bottom-0 flex items-end gap-2 border-t bg-background py-4">
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="輸入你的財務問題……（Shift+Enter 換行）"
        rows={1}
        disabled={disabled}
        className="max-h-40 flex-1"
      />
      {disabled ? (
        <Button size="sm" variant="secondary" onClick={onAbort}>
          中斷
        </Button>
      ) : (
        <Button size="sm" onClick={handleSubmit} disabled={!text.trim()}>
          送出
        </Button>
      )}
    </div>
  );
}
