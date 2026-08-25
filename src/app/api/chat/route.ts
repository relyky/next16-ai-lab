import { NextResponse } from "next/server";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";

export const runtime = "nodejs";

// 模型別名（'fable' | 'opus' | 'sonnet' | 'haiku'）或完整 model ID。
const DEFAULT_MODEL = "haiku";

const SYSTEM_PROMPT =
  "你是一位專業的財務助手，協助使用者理解財務報表與經營數據。" +
  "回答務必使用繁體中文，語氣專業、簡潔，並在資訊不足時主動說明。";

export async function POST(request: Request) {
  let prompt: unknown;
  let sessionId: unknown;
  try {
    ({ prompt, sessionId } = await request.json());
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "請輸入問題" }, { status: 400 });
  }

  if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId)) {
    return NextResponse.json({ error: "sessionId 格式錯誤" }, { status: 400 });
  }

  const options: Options = {
    model: DEFAULT_MODEL,
    maxTurns: 1,
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  try {
    for await (const message of query({ prompt, options })) {
      if (message.type !== "result") continue;

      if (message.subtype !== "success") {
        return NextResponse.json(
          { error: `LLM 回應失敗（${message.subtype}）` },
          { status: 500 }
        );
      }

      // session_id 以本次結果為準：resume 有可能 fork 出新的 session。
      return NextResponse.json({
        result: message.result,
        sessionId: message.session_id,
      });
    }

    return NextResponse.json({ error: "LLM 沒有回應" }, { status: 500 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "LLM 呼叫失敗" },
      { status: 500 }
    );
  }
}
