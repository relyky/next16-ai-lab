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

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/輸入你的財務問題/), question);
  await user.click(screen.getByRole("button", { name: "送出" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Chat page", () => {
  it("顯示 LLM 回覆", async () => {
    stubFetch(async () =>
      jsonResponse({ result: "本季營收成長 12%。", sessionId: "s-1" })
    );

    render(<ChatPage />);
    await ask("這季營收如何？");

    expect(await screen.findByText("本季營收成長 12%。")).toBeInTheDocument();
    expect(screen.getByText("這季營收如何？")).toBeInTheDocument();
  });

  it("第二次提問會帶上前一次回傳的 sessionId", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ result: "好的。", sessionId: "s-1" })
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
