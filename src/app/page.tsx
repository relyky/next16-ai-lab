import { QuarterlyRevenueBars } from "@/components/quarterly-revenue-bars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 items-center gap-12 px-4 py-16 md:grid-cols-2">
      <div className="flex flex-col items-start gap-6">
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          AI AGENT．財務分析
        </Badge>
        <h1 className="text-4xl font-bold leading-tight md:text-5xl">
          用對話
          <br />
          看懂你的財報
        </h1>
        <p className="text-muted-foreground">
          我的財務助手是一個簡化的 AI 對話工具。直接用文字提問，
          就能拿到分析文字與對應的圖表——營收趨勢、成本結構、
          財務摘要，一次講清楚。
        </p>
        <div className="flex items-center gap-3">
          <Button size="lg">開始對話</Button>
          <Button size="lg" variant="outline">
            了解更多
          </Button>
        </div>
      </div>

      <Card className="gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium text-primary">對話預覽</span>
          <Badge variant="outline">Demo</Badge>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">
              這季的營收趨勢如何？
            </div>
          </div>
          <div className="max-w-[90%] rounded-xl border bg-background px-4 py-3 text-sm">
            近四個季度營收持續成長，Q4 較 Q1 增加約 44%。
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              各季度營收（萬元）
            </span>
            <QuarterlyRevenueBars />
          </div>
        </div>
      </Card>
    </div>
  );
}
