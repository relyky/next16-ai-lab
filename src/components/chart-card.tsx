"use client";

/**
 * 圖表卡片：把 charts MCP tool 回傳的圖表定義 JSON 渲染成 recharts 圖表。
 *
 * 三種圖表（line/bar/area）共用同一組軸線／格線／tooltip 設定，
 * 只有「畫什麼形狀」不同，因此差異集中在 CHART_KINDS 這張表裡。
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartDefinition, ChartType } from "@/lib/charts/chart-tool";

/** 未指定顏色時的預設配色，沿用專案既有的 shadcn 圖表 CSS 變數。 */
const FALLBACK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type ChartSeries = ChartDefinition["series"][number];

/** 數列顏色：呼叫端指定的優先，否則依序循環套用預設配色。 */
export function seriesColorAt(series: ChartSeries, index: number) {
  return series.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/**
 * 各圖表類型對應的 recharts 容器、數列元件，與該類型專屬的數列 props。
 *
 * 用 Record 而非 if/else 串接，是為了讓「新增一種圖表」只需多一列設定。
 * `seriesProps` 各自帶自己需要的東西：折線／區域用 `type` 決定曲線形狀（Bar 沒有這個 prop），
 * 顏色也依「線」或「面」套到不同屬性上。
 */
const CHART_KINDS = {
  line: {
    Container: LineChart,
    Series: Line,
    seriesProps: (color: string) => ({ type: "monotone" as const, stroke: color }),
  },
  bar: {
    Container: BarChart,
    Series: Bar,
    seriesProps: (color: string) => ({ fill: color }),
  },
  area: {
    Container: AreaChart,
    Series: Area,
    seriesProps: (color: string) => ({
      type: "monotone" as const,
      stroke: color,
      fill: color,
      fillOpacity: 0.25,
    }),
  },
} satisfies Record<
  ChartType,
  {
    Container: React.ElementType;
    Series: React.ElementType;
    seriesProps: (color: string) => Record<string, unknown>;
  }
>;

export function ChartCard({ chart }: { chart: ChartDefinition }) {
  const { type, title, data, xKey, series } = chart;
  const { Container, Series, seriesProps } = CHART_KINDS[type];

  return (
    <div data-slot="chart-card" className="w-full rounded-lg border bg-card p-4">
      {title ? (
        <div data-slot="chart-title" className="mb-3 text-sm font-medium">
          {title}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={240}>
        <Container data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          {/* 只有一組數列時圖例是冗贅資訊，標題已說明畫的是什麼。 */}
          {series.length > 1 ? <Legend /> : null}
          {series.map((s, index) => (
            <Series
              key={s.key}
              dataKey={s.key}
              name={s.label ?? s.key}
              {...seriesProps(seriesColorAt(s, index))}
            />
          ))}
        </Container>
      </ResponsiveContainer>
    </div>
  );
}
