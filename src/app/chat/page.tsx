import { ChatInput } from "@/components/chat-input";
import { CostStructurePie } from "@/components/cost-structure-pie";
import { ProfitTrendLine } from "@/components/profit-trend-line";
import { QuarterlyRevenueBars } from "@/components/quarterly-revenue-bars";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

type ChartKind = "bar" | "line" | "pie";

const CHART_LABEL: Record<ChartKind, string> = {
  bar: "長條圖",
  line: "折線圖",
  pie: "圓餅圖",
};

function AssistantMessage({
  text,
  chartTitle,
  chart,
}: {
  text: string;
  chartTitle: string;
  chart: ChartKind;
}) {
  return (
    <div className="flex justify-start">
      <Card className="max-w-[90%] gap-3 p-0">
        <div className="px-4 pt-3 text-sm">{text}</div>
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {chartTitle}
            </span>
            <Button size="sm" variant="outline">
              {CHART_LABEL[chart]}
            </Button>
          </div>
          {chart === "bar" && <QuarterlyRevenueBars />}
          {chart === "line" && <ProfitTrendLine />}
          {chart === "pie" && <CostStructurePie />}
        </div>
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          點擊查看完整圖表與下載
        </div>
      </Card>
    </div>
  );
}

export default function ChatPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <div className="flex flex-1 flex-col gap-4 py-8">
        <UserMessage text="這季的營收趨勢如何？" />
        <AssistantMessage
          text="近四個季度營收持續成長，Q4 較 Q1 增加約 44%，主要來自新產品線的貢獻。"
          chartTitle="各季度營收（萬元）"
          chart="bar"
        />
        <UserMessage text="近半年的利潤變化呢？" />
        <AssistantMessage
          text="近六個月利潤呈波動上升，5、6 月成長最為明顯。"
          chartTitle="近 6 個月利潤趨勢（萬元）"
          chart="line"
        />
        <UserMessage text="成本主要花在哪裡？" />
        <AssistantMessage
          text="人力成本佔比最高，其次是行銷與研發支出。"
          chartTitle="成本結構占比"
          chart="pie"
        />
      </div>

      <ChatInput />
    </div>
  );
}
