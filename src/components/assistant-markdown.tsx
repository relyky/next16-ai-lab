"use client";

/**
 * 助手回覆的 markdown 渲染器。
 *
 * 把 Streamdown 的組態收斂在這裡，對話頁只需傳入文字與是否正在動畫，
 * 不必被一堆 plugin import 塞滿。本元件同時承擔既有文字區塊的內距樣式，
 * 泡泡外觀不變。
 *
 * **使用者訊息刻意不走這條路徑**——使用者打字通常不是 markdown，
 * 渲染會吃掉 `1. ` / `- ` / `#` 開頭的字面輸入。這是刻意的不對稱。
 */
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";

import "katex/dist/katex.min.css";
import "streamdown/styles.css";

/**
 * plugin 組態必須是模組層級常數。
 *
 * 專案啟用了 React Compiler，而 Streamdown 本身是記憶化元件；每次 render
 * 傳入新的物件字面量會使記憶化永遠失效，串流時每個文字增量都會重繪整棵
 * markdown 樹——正是記憶化要擋的事。
 *
 * 刻意不含 mermaid：本專案圖表走 recharts 與圖表卡片，且它是四者中最重的相依。
 */
const PLUGINS = { cjk, code, math };

export function AssistantMarkdown({
  text,
  isAnimating = false,
}: {
  text: string;
  /** 只有正在串流的那一則才該為 true，否則歷史訊息會跟著重播淡入。 */
  isAnimating?: boolean;
}) {
  return (
    <div data-slot="assistant-markdown" className="px-4 py-3 text-sm">
      <Streamdown animated isAnimating={isAnimating} plugins={PLUGINS}>
        {text}
      </Streamdown>
    </div>
  );
}
