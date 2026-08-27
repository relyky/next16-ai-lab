import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPage from "./page";

function stubFetch(impl: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn(impl));
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

/** 以指定的位元組 chunk 模擬串流回應（chunk 邊界可落在一行、甚至一個字元中間）。 */
function streamResponse(chunks: Uint8Array[]) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

/** 送出前段事件後停住，直到 fetch 的 signal 被中止才讓 read() 以 AbortError 拒絕。 */
function abortableStreamResponse(chunks: Uint8Array[], signal?: AbortSignal) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: chunks[i++] })
            : new Promise<never>((_, reject) => {
                signal?.addEventListener("abort", () =>
                  reject(new DOMException("Aborted", "AbortError"))
                );
              }),
      }),
    },
  } as unknown as Response;
}

function ndjson(...events: unknown[]) {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

/** 整段 NDJSON 一次送出。 */
function ndjsonResponse(...events: unknown[]) {
  return streamResponse([new TextEncoder().encode(ndjson(...events))]);
}

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/輸入你的財務問題/), question);
  await user.click(screen.getByRole("button", { name: "送出" }));
}

/**
 * 助手回覆文字的斷言輔助。
 *
 * 回覆文字會被包進區塊元素、也可能跨元素切分，`getByText` 這種
 * 「單一元素的文字完全相符」的查詢無法表達要問的事。這裡一律改以
 * 助手泡泡整體的文字內容做包含判斷：語意上要問的本來就是
 * 「這則回覆裡有沒有講到這句話」，而不是「哪個元素剛好等於這句話」。
 *
 * 使用者泡泡、工具名稱、工具失敗原因、用量累計列都不走這條路徑，
 * 它們的斷言維持原本的 `screen.getByText`。
 */
function assistantBubbles() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="assistant-message"]')
  );
}

function bubbleHasText(bubble: HTMLElement, text: string | RegExp) {
  const content = bubble.textContent ?? "";
  return typeof text === "string" ? content.includes(text) : text.test(content);
}

/** 目前畫面上是否有任何助手泡泡提到 `text`。 */
function hasAssistantText(text: string | RegExp) {
  return assistantBubbles().some((bubble) => bubbleHasText(bubble, text));
}

/** 取得提到 `text` 的助手泡泡；找不到即失敗。 */
function getAssistantMessage(text: string | RegExp) {
  const bubble = assistantBubbles().find((b) => bubbleHasText(b, text));
  expect(bubble, `找不到提到 ${text} 的助手回覆`).toBeDefined();
  return bubble!;
}

/** 等待某則助手泡泡提到 `text`，回傳該泡泡。 */
async function findAssistantMessage(text: string | RegExp) {
  await waitFor(() => expect(hasAssistantText(text)).toBe(true));
  return getAssistantMessage(text);
}

/**
 * 泡泡中提到 `text` 的最內層元素，供 DOM 順序比較使用。
 * 文件順序中後代必定排在祖先之後，故最後一個命中者即最內層。
 */
function assistantTextElement(bubble: HTMLElement, text: string) {
  const hits = Array.from(bubble.querySelectorAll("*")).filter((el) =>
    el.textContent?.includes(text)
  );
  expect(hits.at(-1), `助手回覆中找不到 ${text}`).toBeDefined();
  return hits.at(-1)!;
}

/** 泡泡中的提示元素（中斷／失敗），沒有則為 null。 */
function assistantNotice(bubble: HTMLElement) {
  return bubble.querySelector('[data-slot="assistant-notice"]');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const chartEvent = (type: "line" | "bar" | "area", title: string) => ({
  type: "chart" as const,
  chart: {
    type,
    title,
    data: [
      { month: "1月", revenue: 120 },
      { month: "2月", revenue: 150 },
    ],
    xKey: "month",
    series: [{ key: "revenue", label: "營收" }],
  },
});

describe("Chat page 圖表渲染", () => {
  it("收到 chart 事件時，在回應泡泡中渲染圖表卡片", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: "我畫給你看。" },
        chartEvent("line", "月營收趨勢"),
        { type: "done", result: "如圖所示。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("月營收趨勢如何？");

    expect(await findAssistantMessage("如圖所示。")).toBeInTheDocument();
    expect(screen.getByText("月營收趨勢")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="chart-card"]')).toHaveLength(1);
  });

  it("一則回應含多個 chart 事件時，依序渲染多張圖表卡片", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        chartEvent("line", "月營收趨勢"),
        chartEvent("bar", "各部門支出"),
        { type: "done", result: "兩張圖如上。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("給我兩張圖");

    expect(await findAssistantMessage("兩張圖如上。")).toBeInTheDocument();
    const titles = Array.from(
      container.querySelectorAll('[data-slot="chart-title"]')
    ).map((el) => el.textContent);
    expect(titles).toEqual(["月營收趨勢", "各部門支出"]);
  });

  it("下一則提問的圖表不會混進上一則回應", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse(chartEvent("line", "第一張"), {
        type: "done",
        result: "第一則。",
        sessionId: "s-1",
      })
    );

    const { container } = render(<ChatPage />);
    await ask("第一個問題");
    await findAssistantMessage("第一則。");

    fetchMock.mockImplementation(async () =>
      ndjsonResponse(chartEvent("bar", "第二張"), {
        type: "done",
        result: "第二則。",
        sessionId: "s-1",
      })
    );
    await ask("第二個問題");
    await findAssistantMessage("第二則。");

    const bubbles = container.querySelectorAll('[data-slot="assistant-message"]');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].querySelectorAll('[data-slot="chart-card"]')).toHaveLength(1);
    expect(bubbles[1].querySelectorAll('[data-slot="chart-card"]')).toHaveLength(1);
    expect(bubbles[0].textContent).toContain("第一張");
    expect(bubbles[1].textContent).toContain("第二張");
  });
});

describe("Chat page 工具呼叫歷程", () => {
  const toolUse = (id: string, name: string) => ({ type: "tool_use", id, name });

  it("工具進行中顯示旋轉指示器，收到結束事件後轉為成功圖示", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        toolUse("t-1", "mcp__qadb__search_asvt_project_basic"),
        { type: "tool_done", id: "t-1", ok: true },
        { type: "done", result: "共 5 個專案。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("有幾個專案？");

    expect(await findAssistantMessage("共 5 個專案。")).toBeInTheDocument();
    // 工具全名以原樣顯示，不做前綴剝除。
    expect(
      screen.getByText("mcp__qadb__search_asvt_project_basic")
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="success"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-usage-spinner"]')).toBeNull();
  });

  it("結束事件尚未到達時停留在進行中狀態", async () => {
    stubFetch(async (_input, init) =>
      abortableStreamResponse(
        [
          new TextEncoder().encode(
            ndjson(toolUse("t-1", "mcp__qadb__query"))
          ),
        ],
        init?.signal ?? undefined
      )
    );

    const { container } = render(<ChatPage />);
    await ask("查一下");

    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="tool-usage"][data-status="running"]')
      ).not.toBeNull()
    );
    expect(
      container.querySelector('[data-slot="tool-usage-spinner"]')
    ).not.toBeNull();
  });

  it("工具失敗時顯示失敗圖示與簡短訊息", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        toolUse("t-1", "mcp__qadb__query"),
        { type: "tool_done", id: "t-1", ok: false, message: "連線逾時" },
        { type: "done", result: "抱歉，查不到。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("查一下");

    expect(await findAssistantMessage("抱歉，查不到。")).toBeInTheDocument();
    expect(screen.getByText("連線逾時")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="error"]')
    ).not.toBeNull();
  });

  it("多個工具依呼叫順序排列", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        toolUse("t-1", "mcp__qadb__query"),
        { type: "tool_done", id: "t-1", ok: true },
        toolUse("t-2", "mcp__charts__bar_chart"),
        { type: "tool_done", id: "t-2", ok: true },
        { type: "done", result: "如圖所示。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("畫張圖");

    await findAssistantMessage("如圖所示。");
    const names = Array.from(
      container.querySelectorAll('[data-slot="tool-usage"]')
    ).map((el) => el.querySelector("span")?.textContent);
    expect(names).toEqual(["mcp__qadb__query", "mcp__charts__bar_chart"]);
  });

  it("工具列渲染在回應文字之前", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        toolUse("t-1", "mcp__qadb__query"),
        { type: "tool_done", id: "t-1", ok: true },
        { type: "done", result: "共 5 個專案。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("有幾個專案？");

    const bubble = await findAssistantMessage("共 5 個專案。");
    const list = bubble.querySelector('[data-slot="tool-usage-list"]')!;
    const text = assistantTextElement(bubble, "共 5 個專案。");
    expect(
      list.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("開關關閉時工具列不渲染，重新開啟後先前歷程完整重現", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        toolUse("t-1", "mcp__qadb__query"),
        { type: "tool_done", id: "t-1", ok: true },
        { type: "done", result: "共 5 個專案。", sessionId: "s-1" }
      )
    );

    const user = userEvent.setup();
    const { container } = render(<ChatPage />);
    await ask("有幾個專案？");
    await findAssistantMessage("共 5 個專案。");

    const toggle = screen.getByRole("switch", { name: /顯示處理過程/ });
    await user.click(toggle);

    expect(container.querySelector('[data-slot="tool-usage-list"]')).toBeNull();
    // 純顯示濾鏡：文字不受影響。
    expect(getAssistantMessage("共 5 個專案。")).toBeInTheDocument();

    await user.click(toggle);

    expect(await screen.findByText("mcp__qadb__query")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="success"]')
    ).not.toBeNull();
  });

  it("開關預設為開啟", async () => {
    render(<ChatPage />);

    expect(screen.getByRole("switch", { name: /顯示處理過程/ })).toBeChecked();
  });

  it("中斷後不留下任何進行中的工具", async () => {
    stubFetch(async (_input, init) =>
      abortableStreamResponse(
        [
          new TextEncoder().encode(
            ndjson(
              { type: "session", sessionId: "s-1" },
              toolUse("t-1", "mcp__qadb__query")
            )
          ),
        ],
        init?.signal ?? undefined
      )
    );

    const user = userEvent.setup();
    const { container } = render(<ChatPage />);
    await ask("查一下");

    await screen.findByText("mcp__qadb__query");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    await findAssistantMessage("（已中斷）");
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="running"]')
    ).toBeNull();
    // 收成終態時標示為已中斷，使用者不會誤以為工具是自己失敗的。
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="error"]')
        ?.textContent
    ).toContain("已中斷");
    expect(container.querySelector('[data-slot="tool-usage-spinner"]')).toBeNull();
  });

  it("串流正常結束但工具沒有結束事件時，不留下進行中的工具", async () => {
    // tool_result 未送達就收到 done（工具權限被拒、turn 用盡等），
    // 若不收尾會在一則「成功」的回應上留下永遠轉圈的指示器。
    stubFetch(async () =>
      ndjsonResponse(toolUse("t-1", "mcp__qadb__query"), {
        type: "done",
        result: "共 5 個專案。",
        sessionId: "s-1",
      })
    );

    const { container } = render(<ChatPage />);
    await ask("查一下");

    expect(await findAssistantMessage("共 5 個專案。")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="running"]')
    ).toBeNull();
    expect(container.querySelector('[data-slot="tool-usage-spinner"]')).toBeNull();
  });

  it("串流失敗後不留下任何進行中的工具", async () => {
    stubFetch(async () =>
      ndjsonResponse(toolUse("t-1", "mcp__qadb__query"), {
        type: "error",
        error: "連線中斷",
      })
    );

    const { container } = render(<ChatPage />);
    await ask("查一下");

    expect(await findAssistantMessage(/連線中斷/)).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="running"]')
    ).toBeNull();
    expect(container.querySelector('[data-slot="tool-usage-spinner"]')).toBeNull();
  });

  it("工具歷程不影響圖表卡片的渲染", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        toolUse("t-1", "mcp__charts__line_chart"),
        { type: "tool_done", id: "t-1", ok: true },
        chartEvent("line", "月營收趨勢"),
        { type: "done", result: "如圖所示。", sessionId: "s-1" }
      )
    );

    const { container } = render(<ChatPage />);
    await ask("畫張圖");

    await findAssistantMessage("如圖所示。");
    expect(container.querySelectorAll('[data-slot="chart-card"]')).toHaveLength(1);
    expect(screen.getByText("mcp__charts__line_chart")).toBeInTheDocument();
  });
});

describe("Chat page", () => {
  it("逐段顯示串流回覆，並以最終完整內容為準", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: "本季營收" },
        { type: "delta", text: "成長 12%。" },
        { type: "done", result: "本季營收成長 12%。", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage("本季營收成長 12%。")).toBeInTheDocument();
    expect(screen.getByText("這季營收如何？")).toBeInTheDocument();
  });

  it("chunk 切在多位元組字元中間時仍能正確組回文字", async () => {
    const bytes = new TextEncoder().encode(
      ndjson(
        { type: "delta", text: "毛利率為 38%。" },
        { type: "done", result: "毛利率為 38%。", sessionId: "s-1" }
      )
    );
    // 「毛」的 UTF-8 是 3 bytes，切在第 1 個 byte 之後即切斷該字元。
    const cut = bytes.indexOf(0xe6) + 1;
    expect(cut).toBeGreaterThan(0);

    stubFetch(async () =>
      streamResponse([bytes.slice(0, cut), bytes.slice(cut)])
    );

    render(<ChatPage />);
    await ask("毛利率？");

    expect(await findAssistantMessage("毛利率為 38%。")).toBeInTheDocument();
  });

  it("done 的 result 為空時保留已累積的增量文字", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: "本季營收" },
        { type: "done", result: "", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage("本季營收")).toBeInTheDocument();
  });

  it("沒有 done 事件時保留已累積的增量文字", async () => {
    stubFetch(async () => ndjsonResponse({ type: "delta", text: "只有增量。" }));

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage("只有增量。")).toBeInTheDocument();
  });

  it("第二次提問會帶上前一次回傳的 sessionId", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse({ type: "done", result: "好的。", sessionId: "s-1" })
    );

    render(<ChatPage />);
    await ask("第一個問題");
    await findAssistantMessage("好的。");
    await ask("追問");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      prompt: "第一個問題",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sessionId).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      prompt: "追問",
      sessionId: "s-1",
    });
  });

  it("串流期間顯示中斷按鈕，點擊後保留已顯示文字並標示已中斷", async () => {
    const fetchMock = stubFetch(async (_input, init) =>
      abortableStreamResponse(
        [
          new TextEncoder().encode(
            ndjson(
              { type: "session", sessionId: "s-1" },
              { type: "delta", text: "本季營收" }
            )
          ),
        ],
        init?.signal ?? undefined
      )
    );

    const user = userEvent.setup();
    render(<ChatPage />);
    await ask("這季營收如何？");

    await findAssistantMessage("本季營收");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    expect(await findAssistantMessage(/本季營收/)).toBeInTheDocument();
    expect(getAssistantMessage(/已中斷/)).toBeInTheDocument();
    expect(hasAssistantText(/抱歉/)).toBe(false);
    // fetch 確實被中止，瀏覽器不會再送來後續增量。
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("中斷後可繼續提問，並帶上中斷前取得的 sessionId", async () => {
    const fetchMock = stubFetch(async (_input, init) =>
      fetchMock.mock.calls.length === 1
        ? abortableStreamResponse(
            [
              new TextEncoder().encode(
                ndjson(
                  { type: "session", sessionId: "s-1" },
                  { type: "delta", text: "本季營收" }
                )
              ),
            ],
            init?.signal ?? undefined
          )
        : ndjsonResponse({ type: "done", result: "好的。", sessionId: "s-2" })
    );

    const user = userEvent.setup();
    render(<ChatPage />);
    await ask("這季營收如何？");
    await findAssistantMessage("本季營收");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    await findAssistantMessage(/已中斷/);
    await ask("追問");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      prompt: "追問",
      sessionId: "s-1",
    });
  });

  it("HTTP 錯誤時顯示伺服器的錯誤訊息", async () => {
    stubFetch(async () =>
      jsonResponse({ error: "LLM 回應失敗（error_during_execution）" }, false)
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(
      await findAssistantMessage(/LLM 回應失敗（error_during_execution）/)
    ).toBeInTheDocument();
  });

  it("串流中的 error 事件顯示為錯誤助手訊息", async () => {
    stubFetch(async () =>
      ndjsonResponse({
        type: "error",
        error: "LLM 回應失敗（error_during_execution）",
      })
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(
      await findAssistantMessage(/LLM 回應失敗（error_during_execution）/)
    ).toBeInTheDocument();
  });

  it("串流中途出錯時保留已浮現的內容，並附上錯誤提示", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: "本季營收" },
        { type: "error", error: "連線中斷" }
      )
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage(/本季營收/)).toBeInTheDocument();
    expect(getAssistantMessage(/連線中斷/)).toBeInTheDocument();
  });

  it("回應 body 沒有任何事件時顯示錯誤，不會靜默無反應", async () => {
    stubFetch(async () => streamResponse([]));

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage(/回應格式錯誤/)).toBeInTheDocument();
  });

  it("只收到 session 事件就斷線時顯示錯誤，不會靜默無反應", async () => {
    stubFetch(async () => ndjsonResponse({ type: "session", sessionId: "s-1" }));

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage(/回應格式錯誤/)).toBeInTheDocument();
  });

  it("回應不是 NDJSON 時顯示錯誤，不會靜默吞掉內容", async () => {
    stubFetch(async () =>
      streamResponse([new TextEncoder().encode("<html>500</html>")])
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage(/回應格式錯誤/)).toBeInTheDocument();
  });

  it("呼叫失敗時顯示錯誤助手訊息，且仍可繼續輸入", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await findAssistantMessage(/network down/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/輸入你的財務問題/)).toBeEnabled();
  });
});

describe("Chat page 提示訊息", () => {
  /** 停在一個未閉合的程式碼圍欄——串流中斷時最常見、也最容易吞掉後續文字的形狀。 */
  const unterminatedFence = "以下是計算方式：\n\n```python\ntotal = 1 + 2";

  it("中斷提示與已浮現的回覆內容位於不同元素", async () => {
    stubFetch(async (_input, init) =>
      abortableStreamResponse(
        [
          new TextEncoder().encode(
            ndjson({ type: "delta", text: unterminatedFence })
          ),
        ],
        init?.signal ?? undefined
      )
    );

    const user = userEvent.setup();
    render(<ChatPage />);
    await ask("怎麼算的？");

    const bubble = await findAssistantMessage("total = 1 + 2");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    await waitFor(() => expect(assistantNotice(bubble)).not.toBeNull());
    const notice = assistantNotice(bubble)!;
    expect(notice.textContent).toBe("（已中斷）");
    // 提示自成一個元素，不與回覆內容共用容器：日後接上 markdown 渲染時
    // 才不會被未閉合的程式碼圍欄吞進程式碼區塊裡。
    const body = assistantTextElement(bubble, "total = 1 + 2");
    expect(notice.contains(body)).toBe(false);
    expect(body.contains(notice)).toBe(false);
    expect(body.textContent).not.toContain("已中斷");
    // 中斷前已浮現的內容完整保留。
    expect(body.textContent).toContain("以下是計算方式：");
  });

  it("失敗提示與已浮現的回覆內容位於不同元素", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: unterminatedFence },
        { type: "error", error: "連線中斷" }
      )
    );

    render(<ChatPage />);
    await ask("怎麼算的？");

    const bubble = await findAssistantMessage(/連線中斷/);
    const notice = assistantNotice(bubble)!;
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("連線中斷");

    const body = assistantTextElement(bubble, "total = 1 + 2");
    expect(notice.contains(body)).toBe(false);
    expect(body.contains(notice)).toBe(false);
    expect(body.textContent).not.toContain("連線中斷");
  });

  it("提示排在回覆內容之後", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: "本季營收" },
        { type: "error", error: "連線中斷" }
      )
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    const bubble = await findAssistantMessage(/連線中斷/);
    const body = assistantTextElement(bubble, "本季營收");
    const notice = assistantNotice(bubble)!;
    expect(
      body.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("尚無任何回覆內容時，只有提示也照樣顯示", async () => {
    stubFetch(async () => ndjsonResponse({ type: "error", error: "連線中斷" }));

    render(<ChatPage />);
    await ask("這季營收如何？");

    const bubble = await findAssistantMessage(/連線中斷/);
    const notice = assistantNotice(bubble)!;
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("連線中斷");
    // 回覆內容為空，泡泡裡就只剩提示。
    expect(bubble.textContent).toBe(notice.textContent);
  });

  it("中斷時工具歷程仍收成終態，提示不影響工具列", async () => {
    stubFetch(async (_input, init) =>
      abortableStreamResponse(
        [
          new TextEncoder().encode(
            ndjson(
              { type: "tool_use", id: "t-1", name: "mcp__qadb__query" },
              { type: "delta", text: unterminatedFence }
            )
          ),
        ],
        init?.signal ?? undefined
      )
    );

    const user = userEvent.setup();
    const { container } = render(<ChatPage />);
    await ask("怎麼算的？");

    const bubble = await findAssistantMessage("total = 1 + 2");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    await waitFor(() => expect(assistantNotice(bubble)).not.toBeNull());
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="running"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-slot="tool-usage"][data-status="error"]')
        ?.textContent
    ).toContain("已中斷");
    // 工具列仍排在回覆內容之前。
    const list = bubble.querySelector('[data-slot="tool-usage-list"]')!;
    const body = assistantTextElement(bubble, "total = 1 + 2");
    expect(
      list.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("Chat page 用量累計", () => {
  const usageEvent = (
    partial: Partial<{
      in: number;
      cache_c: number;
      cache_r: number;
      out: number;
    }>
  ) => ({ type: "usage" as const, in: 0, cache_c: 0, cache_r: 0, out: 0, ...partial });

  it("尚無任何用量時不渲染累計列", async () => {
    render(<ChatPage />);

    expect(screen.queryByText(/累計消耗/)).not.toBeInTheDocument();
  });

  it("完成一輪後顯示該輪用量，數字帶千分位", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "delta", text: "本季營收成長 12%。" },
        usageEvent({ in: 3, cache_c: 11604, cache_r: 0, out: 442 }),
        { type: "done", result: "本季營收成長 12%。", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(
      await screen.findByText(
        "累計消耗 in 3 | cache_c 11,604 | cache_r 0 | out 442 tokens"
      )
    ).toBeInTheDocument();
  });

  it("多輪的用量逐輪累加", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        usageEvent({ in: 3, cache_c: 100, cache_r: 20, out: 40 }),
        { type: "done", result: "好的。", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("第一問");
    await screen.findByText(/累計消耗 in 3 /);

    stubFetch(async () =>
      ndjsonResponse(
        usageEvent({ in: 7, cache_c: 5, cache_r: 80, out: 2 }),
        { type: "done", result: "好的。", sessionId: "s-2" }
      )
    );
    await ask("第二問");

    expect(
      await screen.findByText(
        "累計消耗 in 10 | cache_c 105 | cache_r 100 | out 42 tokens"
      )
    ).toBeInTheDocument();
  });

  it("sessionId 變更（fork）時不歸零", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        { type: "session", sessionId: "s-1" },
        usageEvent({ out: 40 }),
        { type: "done", result: "好的。", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("第一問");
    await screen.findByText(/out 40 tokens/);

    // 第二輪 resume 後 fork 成新的 session id：使用者仍在同一個對話視窗。
    stubFetch(async () =>
      ndjsonResponse(
        { type: "session", sessionId: "s-2-forked" },
        usageEvent({ out: 2 }),
        { type: "done", result: "好的。", sessionId: "s-2-forked" }
      )
    );
    await ask("第二問");

    expect(await screen.findByText(/out 42 tokens/)).toBeInTheDocument();
  });

  it("失敗的輪次一樣計入累計：那些 token 確實已消耗", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        usageEvent({ in: 3, cache_c: 100, cache_r: 20, out: 40 }),
        { type: "done", result: "好的。", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("第一問");
    await screen.findByText(/out 40 tokens/);

    // 第二輪 turn 用盡：後端先送 usage 再送 error。
    stubFetch(async () =>
      ndjsonResponse(
        usageEvent({ in: 5, cache_c: 0, cache_r: 0, out: 9 }),
        { type: "error", error: "LLM 回應失敗（error_max_turns）" }
      )
    );
    await ask("第二問");
    await findAssistantMessage(/error_max_turns/);

    expect(
      screen.getByText(
        "累計消耗 in 8 | cache_c 100 | cache_r 20 | out 49 tokens"
      )
    ).toBeInTheDocument();
  });

  it("中斷的輪次沒有 usage 事件，不影響既有累計", async () => {
    stubFetch(async () =>
      ndjsonResponse(
        usageEvent({ in: 3, cache_c: 100, cache_r: 20, out: 40 }),
        { type: "done", result: "好的。", sessionId: "s-1" }
      )
    );

    render(<ChatPage />);
    await ask("第一問");
    const before = await screen.findByText(/累計消耗/);
    const text = before.textContent;

    const user = userEvent.setup();
    stubFetch(async (_input, init) =>
      abortableStreamResponse(
        [new TextEncoder().encode(ndjson({ type: "delta", text: "本季" }))],
        (init as RequestInit | undefined)?.signal ?? undefined
      )
    );
    await ask("第二問");
    await findAssistantMessage(/本季/);
    await user.click(screen.getByRole("button", { name: "中斷" }));
    await findAssistantMessage(/（已中斷）/);

    expect(screen.getByText(/累計消耗/).textContent).toBe(text);
  });
});
