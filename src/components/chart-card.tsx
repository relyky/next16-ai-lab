"use client";

/**
 * 圖表卡片：把 charts MCP tool 回傳的圖表定義 JSON 渲染成 recharts 圖表。
 *
 * 結構分三層：外框（邊框與標題）、依 `type` 的分派、各類型的子元件。
 * 分派同時是型別收窄點——圖表定義是 discriminated union，
 * 收窄後子元件才拿得到自己那一種圖表的精確欄位。
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

import type {
  CartesianChartDefinition,
  CartesianChartType,
  ChartDefinition,
} from "@/lib/charts/chart-tool";

/** 未指定顏色時的預設配色，沿用專案既有的 shadcn 圖表 CSS 變數。 */
const FALLBACK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** 依序循環套用預設配色。 */
function fallbackColorAt(index: number) {
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

type ChartSeries = CartesianChartDefinition["series"][number];

/** 數列顏色：呼叫端指定的優先，否則依序循環套用預設配色。 */
export function seriesColorAt(series: ChartSeries, index: number) {
  return series.color ?? fallbackColorAt(index);
}

/**
 * 各笛卡兒圖類型對應的 recharts 容器、數列元件，與該類型專屬的數列 props。
 *
 * 用 Record 而非 if/else 串接，是為了讓「新增一種笛卡兒圖」只需多一列設定。
 * `seriesProps` 各自帶自己需要的東西：折線／區域用 `type` 決定曲線形狀（Bar 沒有這個 prop），
 * 顏色也依「線」或「面」套到不同屬性上。
 */
const CARTESIAN_KINDS = {
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
  CartesianChartType,
  {
    Container: React.ElementType;
    Series: React.ElementType;
    seriesProps: (color: string) => Record<string, unknown>;
  }
>;

/** 笛卡兒圖（line/bar/area）：共用同一組軸線／格線／tooltip 設定。 */
function CartesianChart({ chart }: { chart: CartesianChartDefinition }) {
  const { type, data, xKey, series } = chart;
  const { Container, Series, seriesProps } = CARTESIAN_KINDS[type];

  return (
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
  );
}

/** 依 `type` 分派到各圖表子元件；此處同時完成 union 的型別收窄。 */
function ChartBody({ chart }: { chart: ChartDefinition }) {
  switch (chart.type) {
    case "line":
    case "bar":
    case "area":
      return <CartesianChart chart={chart} />;
  }
}

export function ChartCard({ chart }: { chart: ChartDefinition }) {
  return (
    <div data-slot="chart-card" className="w-full rounded-lg border bg-card p-4">
      {chart.title ? (
        <div data-slot="chart-title" className="mb-3 text-sm font-medium">
          {chart.title}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={240}>
        <ChartBody chart={chart} />
      </ResponsiveContainer>
    </div>
  );
}
