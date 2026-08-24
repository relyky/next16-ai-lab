"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_LLM_PROMPT = "Hello, what's 2+2?";

type TestState = {
  loading: boolean;
  result: string | null;
  error: string | null;
};

const INITIAL_STATE: TestState = { loading: false, result: null, error: null };

export default function AgentLabPage() {
  const [helloState, setHelloState] = useState<TestState>(INITIAL_STATE);
  const [llmState, setLlmState] = useState<TestState>(INITIAL_STATE);
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_LLM_PROMPT);

  async function runTest(
    url: string,
    setState: React.Dispatch<React.SetStateAction<TestState>>,
    init?: RequestInit
  ) {
    setState({ loading: true, result: null, error: null });
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) {
        setState({ loading: false, result: null, error: data.error ?? "請求失敗" });
        return;
      }
      setState({
        loading: false,
        result: data.result ?? data.message ?? JSON.stringify(data),
        error: null,
      });
    } catch (err) {
      setState({
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : "請求失敗",
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-16">
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        Agent Lab
      </Badge>
      <h1 className="text-4xl font-bold leading-tight md:text-5xl">
        Agent Lab
      </h1>
      <p className="text-muted-foreground">
        用來驗證後端 API 與 Claude Agent SDK 是否正常運作的測試頁面。
      </p>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Hello 測試</h2>
            <Button
              size="sm"
              onClick={() => runTest("/api/hello", setHelloState)}
              disabled={helloState.loading}
            >
              {helloState.loading ? "呼叫中..." : "執行測試"}
            </Button>
          </div>
          <TestResult state={helloState} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">LLM 測試（Claude Agent SDK）</h2>
          <Textarea
            value={llmPrompt}
            onChange={(e) => setLlmPrompt(e.target.value)}
            placeholder="輸入要傳給 LLM 的 prompt"
            rows={3}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() =>
                runTest("/api/llm-test", setLlmState, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ prompt: llmPrompt }),
                })
              }
              disabled={llmState.loading || !llmPrompt.trim()}
            >
              {llmState.loading ? "呼叫中..." : "執行測試"}
            </Button>
          </div>
          <TestResult state={llmState} />
        </CardContent>
      </Card>
    </div>
  );
}

function TestResult({ state }: { state: TestState }) {
  if (state.error) {
    return <p className="text-sm text-destructive">{state.error}</p>;
  }
  if (state.result) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {state.result}
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">尚未執行</p>;
}
