import { NextResponse } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "尚未設定 ANTHROPIC_API_KEY，請在 .env.local 補上此環境變數。" },
      { status: 400 }
    );
  }

  try {
    let result = "";
    for await (const message of query({
      prompt: "Hello, what's 2+2?",
      options: {
        maxTurns: 1,
        tools: [],
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
      }
    }

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "LLM 呼叫失敗" },
      { status: 500 }
    );
  }
}
