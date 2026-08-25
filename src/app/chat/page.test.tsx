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

afterEach(() => {
  vi.unstubAllGlobals();
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

    expect(await screen.findByText("本季營收成長 12%。")).toBeInTheDocument();
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

    expect(await screen.findByText("毛利率為 38%。")).toBeInTheDocument();
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

    expect(await screen.findByText("本季營收")).toBeInTheDocument();
  });

  it("沒有 done 事件時保留已累積的增量文字", async () => {
    stubFetch(async () => ndjsonResponse({ type: "delta", text: "只有增量。" }));

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await screen.findByText("只有增量。")).toBeInTheDocument();
  });

  it("第二次提問會帶上前一次回傳的 sessionId", async () => {
    const fetchMock = stubFetch(async () =>
      ndjsonResponse({ type: "done", result: "好的。", sessionId: "s-1" })
    );

    render(<ChatPage />);
    await ask("第一個問題");
    await screen.findByText("好的。");
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

    await screen.findByText("本季營收");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    expect(await screen.findByText(/本季營收/)).toBeInTheDocument();
    expect(screen.getByText(/已中斷/)).toBeInTheDocument();
    expect(screen.queryByText(/抱歉/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
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
    await screen.findByText("本季營收");
    await user.click(await screen.findByRole("button", { name: "中斷" }));

    await screen.findByText(/已中斷/);
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
      await screen.findByText(/LLM 回應失敗（error_during_execution）/)
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
      await screen.findByText(/LLM 回應失敗（error_during_execution）/)
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

    expect(await screen.findByText(/本季營收/)).toBeInTheDocument();
    expect(screen.getByText(/連線中斷/)).toBeInTheDocument();
  });

  it("回應 body 沒有任何事件時顯示錯誤，不會靜默無反應", async () => {
    stubFetch(async () => streamResponse([]));

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await screen.findByText(/回應格式錯誤/)).toBeInTheDocument();
  });

  it("回應不是 NDJSON 時顯示錯誤，不會靜默吞掉內容", async () => {
    stubFetch(async () =>
      streamResponse([new TextEncoder().encode("<html>500</html>")])
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await screen.findByText(/回應格式錯誤/)).toBeInTheDocument();
  });

  it("呼叫失敗時顯示錯誤助手訊息，且仍可繼續輸入", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await screen.findByText(/network down/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/輸入你的財務問題/)).toBeEnabled();
  });
});
