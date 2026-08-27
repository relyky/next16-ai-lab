import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AssistantMarkdown } from "./assistant-markdown";

/**
 * 助手 markdown 元件的元件層測試。
 *
 * 只驗證**外部可觀察的結果**——不斷言渲染器內部的 DOM 結構或 class 名稱，
 * 只斷言「表格渲染成表格元素」「粗體渲染成強調元素」這類語意結果。
 *
 * **刻意不 mock 渲染器**，跑真實渲染。代價是語法高亮首次載入語言與
 * 數學排版會讓測試變慢；換來的是「表格真的渲染成表格」這件事真的被驗證，
 * 而非驗證一個假的替身。此取捨已知並接受。
 */
/**
 * 粗體與連結的錨點。
 *
 * Streamdown 的粗體不是 `<strong>`、連結不是 `<a>`：粗體渲染成帶
 * `data-streamdown="strong"` 的 span，連結渲染成帶 `data-streamdown="link"`
 * 的 button（它支援連結安全性攔截，故用可攔截的控制項而非裸連結）。
 * `data-streamdown` 是渲染器對外的穩定標記，不是內部 class；斜體則是
 * 真正的 `<em>`，照語意元素斷言即可。
 */
function markedAs(root: HTMLElement, kind: string) {
  return root.querySelector<HTMLElement>(`[data-streamdown="${kind}"]`);
}

function renderMarkdown(text: string) {
  const { container } = render(<AssistantMarkdown text={text} />);
  const root = container.querySelector<HTMLElement>(
    '[data-slot="assistant-markdown"]'
  );
  expect(root, "找不到 assistant-markdown 標記").not.toBeNull();
  return root!;
}

describe("AssistantMarkdown", () => {
  it("表格渲染為表格元素", () => {
    const root = renderMarkdown(
      ["| 部門 | 支出 |", "| --- | --- |", "| 研發 | 120 |"].join("\n")
    );

    const table = root.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("th")).toHaveLength(2);
    expect(table!.querySelectorAll("td")).toHaveLength(2);
    expect(table!.textContent).toContain("研發");
  });

  it("標題渲染為對應層級的標題元素", () => {
    const root = renderMarkdown("# 一級\n\n## 二級\n\n### 三級");

    expect(root.querySelector("h1")?.textContent).toContain("一級");
    expect(root.querySelector("h2")?.textContent).toContain("二級");
    expect(root.querySelector("h3")?.textContent).toContain("三級");
  });

  it("無序清單渲染為無序清單元素", () => {
    const root = renderMarkdown("- 營收\n- 成本");

    const ul = root.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll("li")).toHaveLength(2);
  });

  it("有序清單渲染為有序清單元素", () => {
    const root = renderMarkdown("1. 先看營收\n2. 再看成本");

    const ol = root.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll("li")).toHaveLength(2);
  });

  it("粗體與斜體渲染為對應的強調元素", () => {
    const root = renderMarkdown("**重點** 與 *補充*");

    expect(markedAs(root, "strong")?.textContent).toBe("重點");
    expect(root.querySelector("em")?.textContent).toBe("補充");
  });

  it("行內程式碼渲染為程式碼元素", () => {
    const root = renderMarkdown("欄位名稱是 `revenue`。");

    const code = root.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("revenue");
  });

  it("程式碼區塊渲染為程式碼元素", async () => {
    const root = renderMarkdown("```python\ntotal = 1 + 2\n```");

    // 語法高亮是非同步載入語言的，等內容浮現再斷言。
    await waitFor(() => {
      const code = root.querySelector("code");
      expect(code).not.toBeNull();
      expect(code!.textContent).toContain("total = 1 + 2");
    });
  });

  it("引用區塊渲染為引用元素", () => {
    const root = renderMarkdown("> 這是引述的內容。");

    const quote = root.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote!.textContent).toContain("這是引述的內容。");
  });

  it("連結渲染為可點擊的連結元素", () => {
    const root = renderMarkdown("詳見 [年報](https://example.com/report)。");

    const link = markedAs(root, "link");
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("年報");
    // 可點擊：不是一段死文字，而是有互動語意的控制項。
    expect(link!.tagName === "A" || link!.tagName === "BUTTON").toBe(true);
  });

  it("數學公式產生數學排版輸出", async () => {
    render(<AssistantMarkdown text={"複利公式：$$A = P(1 + r)^n$$"} />);

    // KaTeX 的輸出以 .katex 容器為標記，這是它對外可觀察的排版結果。
    await waitFor(() => {
      expect(document.querySelector(".katex")).not.toBeNull();
    });
  });

  it("繁中粗體緊貼全形句號時仍渲染為粗體", () => {
    // `cjk` plugin 的核心驗證：一般 markdown 剖析器在這個寫法下
    // emphasis 會失效。用英文或粗體後接半形標點都測不出此 plugin 是否生效。
    const root = renderMarkdown("這一段的**重點。**後面還有話。");

    const strong = markedAs(root, "strong");
    expect(strong, "繁中粗體緊貼全形句號時未渲染為粗體").not.toBeNull();
    expect(strong!.textContent).toContain("重點。");
    // 星號本身不該留在畫面上。
    expect(root.textContent).not.toContain("**");
  });

  it("連結後接全形標點時，標點不被併入連結", () => {
    const root = renderMarkdown("詳見 https://example.com/report。");

    const link = markedAs(root, "link");
    expect(link).not.toBeNull();
    expect(link!.textContent).not.toContain("。");
    // 標點留在連結外面，仍看得到。
    expect(root.textContent).toContain("。");
  });

  it("未閉合的程式碼圍欄不導致崩潰", async () => {
    // 串流到一半的形狀：圍欄開了還沒收。
    const root = renderMarkdown("以下是計算方式：\n\n```python\ntotal = 1 + 2");

    await waitFor(() => expect(root.textContent).toContain("total = 1 + 2"));
    expect(root.textContent).toContain("以下是計算方式：");
  });

  it("未閉合的表格不導致崩潰", () => {
    const root = renderMarkdown("| 部門 | 支出 |\n| --- | --- |\n| 研發 |");

    expect(root.textContent).toContain("研發");
  });

  it("空字串不導致崩潰", () => {
    const root = renderMarkdown("");

    expect(root).toBeInTheDocument();
  });

  it("使用者可見的純文字原樣呈現", () => {
    render(<AssistantMarkdown text="本季營收成長 12%。" />);

    expect(screen.getByText(/本季營收成長 12%。/)).toBeInTheDocument();
  });
});
