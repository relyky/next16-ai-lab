import { NextResponse } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { prompt } = await request.json();

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "請輸入 prompt" }, { status: 400 });
  }

  try {
    let result = "";
    for await (const message of query({
      prompt,
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
