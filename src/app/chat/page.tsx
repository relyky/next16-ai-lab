import { QuarterlyRevenueBars } from "@/components/quarterly-revenue-bars";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <Card className="max-w-[90%] gap-3 p-0">
        <div className="px-4 pt-3 text-sm">{text}</div>
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              各季度營收（萬元）
            </span>
            <Button size="sm" variant="outline">
              長條圖
            </Button>
          </div>
          <QuarterlyRevenueBars />
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
        <AssistantMessage text="近四個季度營收持續成長，Q4 較 Q1 增加約 44%。" />
        <UserMessage text="近半年的利潤變化呢？" />
        <AssistantMessage text="近半年利潤同步走高，主要受惠於營收成長與成本控管。" />
      </div>

      <div className="sticky bottom-0 border-t bg-background py-4">
        <Input placeholder="輸入你的財務問題……（Shift+Enter 換行）" />
      </div>
    </div>
  );
}
