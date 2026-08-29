import { PieChartTpl } from "./pie-chart-tpl";
import { ScatterChartTpl } from "./scatter-chart-tpl";

export default function ChartsTplPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">圖表樣板</h1>
        <p className="text-sm text-muted-foreground">
          recharts 寫法的實驗場。驗證過的做法再回頭套用到 chart-card。
        </p>
      </div>

      <ScatterChartTpl />
      <PieChartTpl />
    </div>
  );
}
