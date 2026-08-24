"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInputTpl() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = event.target;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  return (
    <div className="sticky bottom-0 flex items-end gap-2 border-t bg-background py-4">
      <Textarea
        ref={textareaRef}
        onChange={handleInput}
        placeholder="輸入你的財務問題……（Shift+Enter 換行）"
        rows={1}
        className="max-h-40 flex-1"
      />
      <Button size="sm">送出</Button>
    </div>
  );
}
