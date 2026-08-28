"use client";

/**
 * 圖表卡片：把 charts MCP tool 回傳的圖表定義 JSON 渲染成 recharts 圖表。
 *
 * 結構分三層：外框（邊框與標題）、依 `type` 的分派、各類型的子元件。
 * 分派同時是型別收窄點——圖表定義是 discriminated union，
 * 收窄後子元件才拿得到自己那一種圖表的精確欄位。
 */
import { createContext, useContext, useMemo } from "react";
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
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import {
  buildChartPalette,
  paletteColorFor,
  type ChartPalette,
} from "@/lib/charts/chart-palette";
import { DEFAULT_BUBBLE_RADIUS_RANGE } from "@/lib/charts/chart-tool";
import type {
  CartesianChartDefinition,
  CartesianChartType,
  ChartDefinition,
  PieChartDefinition,
  RadarChartDefinition,
  ScatterChartDefinition,
} from "@/lib/charts/chart-tool";

/**
 * 名稱 → 色序對照表的供應點。
 *
 * 預設為空 Map：單獨渲染一張圖（如測試、未來的其他頁面）不會壞掉，
 * 只是每個類別都回退到第一個顏色。
 */
const ChartPaletteContext = createContext<ChartPalette>(new Map());

/**
 * 供應對照表給底下所有圖表卡片。
 *
 * `charts` 須依實際產生順序攤平——首次出現順序即色序，順序變了顏色就變了。
 */
export function ChartPaletteProvider({
  charts,
  children,
}: {
  charts: readonly ChartDefinition[];
  children: React.ReactNode;
}) {
  const palette = useMemo(() => buildChartPalette(charts), [charts]);
  return (
    <ChartPaletteContext value={palette}>{children}</ChartPaletteContext>
  );
}

export function useChartPalette() {
  return useContext(ChartPaletteContext);
}

type ChartSeries = CartesianChartDefinition["series"][number];

/**
 * 數列顏色：呼叫端指定的優先，否則依名稱查對照表。
 *
 * 查表的鍵用 `label ?? key`——與圖例顯示的文字同一個來源，
 * 「同一份數據延用同一顏色」的「同一份」才是讀者眼中看到的那個名稱。
 */
export function seriesColorAt(series: ChartSeries, palette: ChartPalette) {
  return series.color ?? paletteColorFor(palette, series.label ?? series.key);
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
  const palette = useChartPalette();

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
      {series.map((s) => (
        <Series
          key={s.key}
          dataKey={s.key}
          name={s.label ?? s.key}
          {...stackProps}
          {...seriesProps(seriesColorAt(s, palette))}
        />
      ))}
    </Container>
  );
}

/**
 * 餅圖的扇形顏色：`colorKey` 指到的欄位有值時勝出，否則依名稱查對照表。
 *
 * 回退依扇形自己的類別名稱而非序號，同一個類別在別張圖裡才是同一個顏色；
 * 混合案例中每個扇形的預設色也不會隨前面幾列有沒有指定色而漂移。
 */
export function sectorColorAt(
  row: Record<string, string | number>,
  nameKey: string,
  colorKey: string | undefined,
  palette: ChartPalette
) {
  const color = colorKey === undefined ? undefined : row[colorKey];
  if (typeof color === "string") return color;
  return paletteColorFor(palette, String(row[nameKey]));
}

/**
 * 扇形標籤：類別名稱 + 佔比百分比。
 *
 * 扇形角度雖然就是佔比，但「這塊看起來比那塊大一點」不等於讀得出數字——
 * 餅圖的用途正是讀比例，故把百分比直接畫在圖上，而不是只藏在 hover 的
 * tooltip 裡（截圖、列印、觸控裝置都沒有 hover）。
 *
 * 百分比由 recharts 提供的 `percent`（0~1）換算，取一位小數：整數會讓
 * 33.3% 與 33.4% 併成同一個數字，看起來像資料有誤。
 *
 * 過小的扇形不標：標籤字寬固定，扇形太窄時文字會互相疊在一起，
 * 反而比不標更難讀。被略過的值仍可由 tooltip 讀到。
 */
const MIN_LABELED_PERCENT = 0.03;

export function renderSectorLabel({
  name,
  percent,
}: {
  name?: string | number;
  percent?: number;
}) {
  if (typeof percent !== "number" || percent < MIN_LABELED_PERCENT) return null;
  return `${name} ${(percent * 100).toFixed(1)}%`;
}

/**
 * 餅圖（單一數列 × 多類別）：無軸線與格線，扇形角度即為佔比。
 *
 * 顏色的層級是「每個扇形一色」，裝不進笛卡兒圖的數列結構，
 * 故由 `colorKey` 指向 data 內的色碼欄位；未指定時回退預設配色。
 *
 * 半徑較容器可容納的上限保守：外置標籤與其引線需要橫向空間，
 * 半徑吃滿寬度會讓標籤被 SVG 邊界裁掉。
 */
function PieChartView({ chart }: { chart: PieChartDefinition }) {
  const { data, nameKey, valueKey, colorKey } = chart;
  const palette = useChartPalette();

  return (
    <PieChart>
      <Tooltip />
      <Legend />
      <Pie
        data={data}
        nameKey={nameKey}
        dataKey={valueKey}
        outerRadius={70}
        isAnimationActive={false}
        label={renderSectorLabel}
        labelLine
      >
        {data.map((row, index) => (
          <Cell
            key={`${row[nameKey]}-${index}`}
            fill={sectorColorAt(row, nameKey, colorKey, palette)}
          />
        ))}
      </Pie>
    </PieChart>
  );
}

/**
 * 雷達圖（極座標上的類別軸 × 多數列）：各數列畫成一塊可疊放的多邊形區域。
 *
 * 不進笛卡兒圖的類型對照表——容器與軸線元件完全不同，表上的「預設是否堆疊」
 * 「數列 props」對它都不成立。
 *
 * 半徑軸顯示但不標刻度數字：雷達圖的讀法是形狀輪廓比較而非讀絕對值，
 * 數字疊在網格上可讀性差；實際數值仍可由 tooltip 取得。這與餅圖「過小的扇形
 * 不標，值仍可由 tooltip 讀到」是同一個取捨立場。
 *
 * 填色不透明度沿用區域圖：多組數列疊放時各層相鄰，過低會讓區塊偏灰、層次不易分辨。
 */
function RadarChartView({ chart }: { chart: RadarChartDefinition }) {
  const { data, angleKey, series } = chart;
  const palette = useChartPalette();

  return (
    <RadarChart data={data}>
      <PolarGrid />
      <PolarAngleAxis dataKey={angleKey} />
      <PolarRadiusAxis tick={false} axisLine={false} />
      <Tooltip />
      {/* 只有一組數列時圖例是冗贅資訊，標題已說明畫的是什麼。 */}
      {series.length > 1 ? <Legend /> : null}
      {series.map((s) => {
        const color = seriesColorAt(s, palette);
        return (
          <Radar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={color}
            fill={color}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
        );
      })}
    </RadarChart>
  );
}

/**
 * 半徑範圍（px）換算成 recharts `ZAxis.range` 需要的面積範圍。
 *
 * recharts 的 `ZAxis.range` 單位是面積（內部以 `radius = sqrt(size / π)` 反推半徑）。
 * 面積在感知上正確——人眼比較圓的大小時比較的是面積——但數字極不直觀
 * （`[64, 400]` 換算成半徑是 4.5px 到 11.3px）。因此契約收半徑，
 * 易錯的換算鎖在這一個具名純函式裡。詳見 docs/adr/0005。
 *
 * 匯出並單獨測試：jsdom 不產生 SVG 幾何，此換算在渲染斷言中驗不到。
 */
export function bubbleAreaRange(
  radiusRange: readonly [number, number] = DEFAULT_BUBBLE_RADIUS_RANGE
): [number, number] {
  const [min, max] = radiusRange;
  return [Math.PI * min * min, Math.PI * max * max];
}

/**
 * 推出散佈圖繪圖區四周需要的邊距。
 *
 * 氣泡以資料點為圓心向外擴張半徑的距離，而位於值域端點的資料點就落在繪圖區邊界上，
 * 半個圓因此會被 SVG 裁掉，最外側的刻度也會被蓋住。recharts 的預設邊距是為
 * 線與長條設計的——它們不超出自己的資料點，散佈圖是唯一會超出的圖表類型。
 *
 * 未提供 `sizeKey` 時所有點是 recharts 的預設尺寸（遠小於半徑上限），不必預留。
 * 左側不必補：Y 軸以 `width="auto"` 自行量出刻度文字所需的寬度。
 */
function bubbleMargin(
  sizeKey: string | undefined,
  range: readonly [number, number] | undefined
) {
  const bubbleRadius = sizeKey ? (range ?? DEFAULT_BUBBLE_RADIUS_RANGE)[1] : 0;

  return { top: bubbleRadius, right: bubbleRadius, bottom: bubbleRadius, left: 0 };
}

/**
 * 散佈圖（連續數值 X 軸 × 多數列）：各數列畫成一組資料點。
 *
 * 不進笛卡兒圖的類型對照表——沒有堆疊概念，且 X 軸是連續數值軸而非等距類別軸。
 * 兩個軸都套用大數值縮寫格式化函式：兩軸都是數值軸。
 *
 * `ZAxis` 只在提供 `sizeKey` 時渲染——沒有第三個維度時多掛一個軸只會讓
 * 所有點被同一個常數尺寸驅動，而 recharts 的預設本來就是這個行為。
 */
function ScatterChartView({ chart }: { chart: ScatterChartDefinition }) {
  const { data, xKey, series, sizeKey, range } = chart;
  const palette = useChartPalette();

  // 單一數列時 Y 軸只承載那一個欄位，其名稱即該軸的名稱；多數列時取其一
  // 會對其餘數列說謊，此時圖例已列出各數列名稱，Y 軸不另取名。
  const yAxisName = series.length === 1 ? (series[0].label ?? series[0].key) : undefined;

  return (
    <ScatterChart margin={bubbleMargin(sizeKey, range)}>
      <CartesianGrid strokeDasharray="3 3" />
      {/*
        三個軸都給 `name`：散佈圖的軸是純數值，刻度本身不說明畫的是什麼，
        名稱要靠 Tooltip 帶出。這也是 `sizeKey` 這個維度唯一的標示管道——
        氣泡大小在圖上沒有圖例可依附。比照 recharts 官方 SimpleScatterChart。

        不用旋轉的軸標題：recharts 的 Label 依水平可用寬度自動斷詞，
        中文旋轉後會被折成一字一行，與函式庫對抗不划算。
      */}
      <XAxis
        type="number"
        dataKey={xKey}
        name={xKey}
        tickFormatter={formatAxisTick}
      />
      {/* width="auto" 讓軸自行量出刻度文字所需寬度，不必猜一個魔術數字。 */}
      <YAxis type="number" name={yAxisName} width="auto" tickFormatter={formatAxisTick} />
      {sizeKey ? (
        <ZAxis type="number" dataKey={sizeKey} name={sizeKey} range={bubbleAreaRange(range)} />
      ) : null}
      <Tooltip />
      {/* 只有一組數列時圖例是冗贅資訊，標題已說明畫的是什麼。 */}
      {series.length > 1 ? <Legend /> : null}
      {series.map((s) => (
        <Scatter
          key={s.key}
          data={data}
          dataKey={s.key}
          name={s.label ?? s.key}
          fill={seriesColorAt(s, palette)}
          isAnimationActive={false}
        />
      ))}
    </ScatterChart>
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
    case "radar":
      return <RadarChartView chart={chart} />;
    case "scatter":
      return <ScatterChartView chart={chart} />;
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
