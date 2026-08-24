import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16">
      <div className="flex flex-col items-start gap-6">
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          關於
        </Badge>
        <h1 className="text-4xl font-bold leading-tight md:text-5xl">
          我的財務助手
        </h1>
        <p className="text-muted-foreground">
          我的財務助手是一個簡化的 AI 對話工具，讓你不需要具備財務背景，
          也能透過自然語言提問，快速理解公司的財務狀況。目前這個版本是一個
          設計原型，用來展示產品的介面樣貌與互動流程，尚未串接真實的資料
          與分析邏輯。
        </p>
      </div>

      <div className="border-t" />

      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            聯絡我們
          </h2>
          <p className="text-sm">hello@myfinassist.app</p>
          <p className="text-sm text-muted-foreground">
            設計原型．僅供內部展示
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
