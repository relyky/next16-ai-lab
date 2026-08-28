import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";

import ChatPage from "@/app/chat/page";
import { loadingAtom, messagesAtom, submitPromptAtom } from "@/lib/chat-store";

/**
 * 次 seam：直接驅動 store。
 *
 * 只承接從 DOM 難以驅動的邊界情境——串流中卸載、id 不重複、防重入。
 * 使用者看得見的行為一律留在頁面測試那個較高的 seam，此處刻意不重測。
 * 以下的小輔助函式與頁面測試檔重複，但那是可接受的重複：不為此去動
 * 既有的大型測試檔，讓它保持零改動。
 */

function stubFetch(impl: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn(impl));
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function ndjson(...events: unknown[]) {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

function ndjsonResponse(...events: unknown[]) {
  const chunks = [new TextEncoder().encode(ndjson(...events))];
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

/** 前段事件送出後停住，直到外部呼叫 release() 才送出後段並結束串流。 */
function pausedStreamResponse(head: unknown[], tail: unknown[]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let stage = 0;
  const response = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (stage === 0) {
            stage = 1;
            return {
              done: false,
              value: new TextEncoder().encode(ndjson(...head)),
            };
          }
          if (stage === 1) {
            stage = 2;
            await gate;
            return {
              done: false,
              value: new TextEncoder().encode(ndjson(...tail)),
            };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  } as unknown as Response;
  return { response, release: () => release() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("對話 store", () => {
  it("串流進行中卸載元件，串流完成後狀態仍完整寫入", async () => {
    const { response, release } = pausedStreamResponse(
      [
        { type: "session", sessionId: "s-1", model: "haiku" },
        { type: "delta", text: "本季營收" },
      ],
      [{ type: "done", result: "本季營收成長兩成。", sessionId: "s-1" }]
    );
    stubFetch(async () => response);

    const store = getDefaultStore();
    render(<ChatPage />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/輸入你的財務問題/),
      "這季營收如何？"
    );
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() =>
      expect(
        store.get(messagesAtom).some((m) => m.text.includes("本季營收"))
      ).toBe(true)
    );

    // 使用者切到別的頁面：元件卸載，但串流還在跑。
    cleanup();
    release();

    await waitFor(() => expect(store.get(loadingAtom)).toBe(false));
    const reply = store.get(messagesAtom).at(-1)!;
    expect(reply.text).toBe("本季營收成長兩成。");
    // 切頁不中止串流，故不該出現一則沒人按過中斷鈕的「（已中斷）」。
    expect(reply.notice).toBeUndefined();
  });

  it("連續多輪的訊息 id 不重複", async () => {
    stubFetch(async () =>
      ndjsonResponse({ type: "done", result: "好的。", sessionId: "s-1" })
    );

    const store = getDefaultStore();
    for (const question of ["第一問", "第二問", "第三問"]) {
      await store.set(submitPromptAtom, question);
    }

    const ids = store.get(messagesAtom).map((m) => m.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("串流進行中的第二次送出被防重入擋下", async () => {
    const { response, release } = pausedStreamResponse(
      [{ type: "delta", text: "第一則" }],
      [{ type: "done", result: "第一則完成。", sessionId: "s-1" }]
    );
    const fetchMock = stubFetch(async () => response);

    const store = getDefaultStore();
    const first = store.set(submitPromptAtom, "第一問");
    await waitFor(() => expect(store.get(loadingAtom)).toBe(true));

    await store.set(submitPromptAtom, "第二問");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get(messagesAtom).some((m) => m.text === "第二問")).toBe(false);

    release();
    await first;
  });
});
