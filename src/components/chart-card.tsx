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
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  CartesianChartDefinition,
  CartesianChartType,
  ChartDefinition,
  PieChartDefinition,
} from "@/lib/charts/chart-tool";

/** 未指定顏色時的預設配色，沿用專案既有的 shadcn 圖表 CSS 變數。 */
const FALLBACK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
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
 * recharts 沒有 `stacked` 這個 prop——堆疊是「相同 stackId 的數列疊在一起」。
 * `stacked` 是我們自己的抽象，為真時給所有數列同一個常數 stackId。
 */
const STACK_ID = "stack";

/**
 * 各笛卡兒圖類型對應的 recharts 容器、數列元件、該類型專屬的數列 props，
 * 以及未指定 `stacked` 時的預設值。
 *
 * 用 Record 而非 if/else 串接，是為了讓「新增一種笛卡兒圖」只需多一列設定。
 * `seriesProps` 各自帶自己需要的東西：折線／區域用 `type` 決定曲線形狀（Bar 沒有這個 prop），
 * 顏色也依「線」或「面」套到不同屬性上。
 *
 * `defaultStacked` 是「哪種圖預設堆疊」這條規則的唯一落點：長條圖主要用途是比較
 * 類別間差異故預設並排，區域圖主要用途是呈現累積變化故預設堆疊。折線圖不接受
 * `stacked`，其值恆為 false。
 */
const CARTESIAN_KINDS = {
  line: {
    Container: LineChart,
    Series: Line,
    defaultStacked: false,
    seriesProps: (color: string) => ({ type: "monotone" as const, stroke: color }),
  },
  bar: {
    Container: BarChart,
    Series: Bar,
    defaultStacked: false,
    seriesProps: (color: string) => ({ fill: color }),
  },
  area: {
    Container: AreaChart,
    Series: Area,
    defaultStacked: true,
    // 不透明度取 recharts 堆疊區域圖範例的預設值：堆疊時各層相鄰，
    // 過低的不透明度會讓區塊偏灰、層次不易分辨。
    seriesProps: (color: string) => ({
      type: "monotone" as const,
      stroke: color,
      fill: color,
      fillOpacity: 0.6,
    }),
  },
} satisfies Record<
  CartesianChartType,
  {
    Container: React.ElementType;
    Series: React.ElementType;
    defaultStacked: boolean;
    seriesProps: (color: string) => Record<string, unknown>;
  }
>;

/**
 * Y 軸刻度標籤：大數值改以 K / M / B 單位縮寫。
 *
 * recharts 預設為 Y 軸保留 60px，而千萬級的原始數字（如 `4000000`）寬約 65px，
 * 會溢出 SVG 左緣被裁掉最高位——四個刻度全顯示成 `000000`，完全讀不出量級。
 * 縮短標籤同時解決寬度與可讀性，比放寬 Y 軸（那會吃掉繪圖區）更划算。
 *
 * 千分位以下維持原樣：財務資料的小額數值不該被四捨五入成 `1K`。
 * 取一位小數，讓 1.5M 與 2M 能區分；整數則不補 `.0`。
 */
export function formatAxisTick(value: number) {
  if (!Number.isFinite(value)) return String(value);

  const abs = Math.abs(value);
  const units = [
    { threshold: 1e9, suffix: "B" },
    { threshold: 1e6, suffix: "M" },
    { threshold: 1e3, suffix: "K" },
  ];

  for (const { threshold, suffix } of units) {
    if (abs >= threshold) {
      const scaled = value / threshold;
      // 取一位小數後去掉尾隨的 .0，讓 2M 不顯示成 2.0M。
      return `${parseFloat(scaled.toFixed(1))}${suffix}`;
    }
  }
  return String(value);
}

/** 笛卡兒圖（line/bar/area）：共用同一組軸線／格線／tooltip 設定。 */
function CartesianChartView({ chart }: { chart: CartesianChartDefinition }) {
  const { type, data, xKey, series } = chart;
  const { Container, Series, defaultStacked, seriesProps } = CARTESIAN_KINDS[type];

  // 定義 JSON 是稀疏的：LLM 沒傳 stacked 時回退到該圖表類型的預設。
  // stackId 的注入邏輯三種圖完全相同，不屬於各類型的差異，故不進對照表。
  //
  // 用 `in` 而非依 type 收窄，是因為 line 分支根本沒有 stacked 這個 key——
  // 那正是「折線圖不接受 stacked」在型別上的表達，不該為了此處好寫而讓三個
  // 分支都帶上這個欄位（那會讓 line_chart 的 tool 簽章對 LLM 說謊）。
  const stacked = ("stacked" in chart ? chart.stacked : undefined) ?? defaultStacked;
  const stackProps = stacked ? { stackId: STACK_ID } : {};

  return (
    <Container data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={xKey} />
      <YAxis tickFormatter={formatAxisTick} />
      <Tooltip />
      {/* 只有一組數列時圖例是冗贅資訊，標題已說明畫的是什麼。 */}
      {series.length > 1 ? <Legend /> : null}
      {series.map((s, index) => (
        <Series
          key={s.key}
          dataKey={s.key}
          name={s.label ?? s.key}
          {...stackProps}
          {...seriesProps(seriesColorAt(s, index))}
        />
      ))}
    </Container>
  );
}

/**
 * 餅圖（單一數列 × 多類別）：無軸線與格線，扇形角度即為佔比。
 *
 * 配色一律由前端依扇形序號循環套用預設配色——資料筆數由 LLM 決定，
 * 要求它逐扇形配色既囉嗦又易出錯。
 */
function PieChartView({ chart }: { chart: PieChartDefinition }) {
  const { data, nameKey, valueKey } = chart;

  return (
    <PieChart>
      <Tooltip />
      <Legend />
      <Pie
        data={data}
        nameKey={nameKey}
        dataKey={valueKey}
        outerRadius={80}
        isAnimationActive={false}
      >
        {data.map((row, index) => (
          <Cell key={`${row[nameKey]}-${index}`} fill={fallbackColorAt(index)} />
        ))}
      </Pie>
    </PieChart>
  );
}

/** 依 `type` 分派到各圖表子元件；此處同時完成 union 的型別收窄。 */
function ChartBody({ chart }: { chart: ChartDefinition }) {
  switch (chart.type) {
    case "line":
    case "bar":
    case "area":
      return <CartesianChartView chart={chart} />;
    case "pie":
      return <PieChartView chart={chart} />;
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
