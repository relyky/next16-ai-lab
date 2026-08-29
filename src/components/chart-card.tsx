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
  DefaultLegendContent,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  Sector,
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
import type { LegendPayload, PieSectorShapeProps } from "recharts";

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
 * 折線／長條／區域／餅／雷達五種圖表的自適應尺寸。
 *
 * recharts 3.x 的 `responsive` prop 取代了 `ResponsiveContainer`——寬度改由圖表
 * 自己依 `style` 量測，不必再多包一層。高度 240 是遷移前 `ResponsiveContainer`
 * 的固定值，沿用以免順帶改變這五種圖表的視覺尺寸。
 *
 * 散佈圖不套這一組：它改用正方形的長寬比（見 SCATTER_CHART_STYLE）。
 */
const FIXED_HEIGHT_CHART_STYLE = { width: "100%", height: 240 } as const;

/**
 * 散佈圖專用的尺寸：正方形，並以視窗高度設上限。
 *
 * 兩軸都是連續數值軸，非正方形的繪圖區會讓同一段距離在兩軸上代表不同的量，
 * 分布形狀因此被拉扁。`maxHeight` 防止寬螢幕下整張圖高過一個畫面。
 * 比照 charts-tpl 的驗證值，但不取它的 `maxWidth`——卡片本身已限寬。
 */
const SCATTER_CHART_STYLE = {
  width: "100%",
  maxHeight: "70vh",
  aspectRatio: 1,
} as const;

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
    <Container data={data} responsive style={FIXED_HEIGHT_CHART_STYLE}>
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
 * 扇形的自訂 shape：逐扇形決定填色。
 *
 * 取代已棄用的 `Cell`——recharts 3.x 標記 `Cell` 為 deprecated 並將於 4.0 移除，
 * 官方替代方案即為此處的 `shape` prop（見 recharts 的 Cell 遷移指南）。
 * `Cell` 被淘汰的理由之一正好也適用於我們：它的 props 依所在圖表而異
 * （Bar 要 Rectangle、Pie 要 Sector），TypeScript 標不出來。
 *
 * 回傳 render function 而非直接當元件用：著色需要的 `nameKey` / `colorKey` /
 * 對照表都不在 recharts 傳進來的 props 裡，得由外層先綁好。
 *
 * 原始資料列從 `payload` 取：recharts 把它原封不動附在每個扇形的 props 上，
 * 故 `colorKey` 指到的欄位在此讀得到。
 */
function sectorShapeRenderer(
  nameKey: string,
  colorKey: string | undefined,
  palette: ChartPalette
) {
  return function PieSector(props: PieSectorShapeProps) {
    const row = props.payload as Record<string, string | number>;
    return <Sector {...props} fill={sectorColorAt(row, nameKey, colorKey, palette)} />;
  };
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
    <PieChart responsive style={FIXED_HEIGHT_CHART_STYLE}>
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
        shape={sectorShapeRenderer(nameKey, colorKey, palette)}
      />
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
    <RadarChart data={data} responsive style={FIXED_HEIGHT_CHART_STYLE}>
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
 * 軸標題：畫在該軸旁邊的名稱，`xLabel` / `yLabel` 未提供時不畫。
 *
 * 回傳 `label` prop 的**物件形式**而非 `<Label>` 元素：兩者看似等價，但傳元素會
 * 讓 recharts 走「先量測標題再決定軸尺寸」的分支（`XAxis.js` 的
 * `isValidElement(label)`），該分支在 jsdom 下量到 0 而整個不渲染——測試因此
 * 一行都驗不到。物件形式由 recharts 自己建構 `Label`，兩種環境行為一致。
 *
 * **`width: undefined` 是這裡的關鍵。** recharts 的 `Label` 會把它算出的 viewBox
 * 寬度往下傳給 `Text`，而 `Text` 只在收到 `width` 時才斷行
 * （`Text.js`: `if ((width || scaleToFit) && ...)`）。Y 軸的 viewBox 寬度就是那條
 * 窄軸本身的寬度，中文因此被折成一字一行——先前判定「與函式庫的斷行邏輯對抗
 * 不划算」而退回旋轉標題，其實症結不在旋轉，而在這個繼承來的寬度。
 *
 * Y 軸標題旋轉 -90°，是笛卡兒圖的通用慣例——由下往上讀，不是我們的發明。
 */
/**
 * 有標題時 X 軸要保留的高度（px）。
 *
 * 標題以 `insideBottom` 排在軸的高度內，`dy` 再把它推到刻度下方，故這個高度
 * 必須同時容得下刻度文字與標題：刻度約 20px + 標題約 20px + 間距。
 * recharts 的 `height="auto"` 只在標題是 React 元素時才量測（物件形式量不到），
 * 故明給一個數字。垂直順序因此是：刻度 → 標題 → 圖例（圖例排在軸的外側）。
 */
const X_AXIS_HEIGHT_WITH_LABEL = 48;

export function axisLabel(value: string | undefined, axis: "x" | "y") {
  if (value === undefined) return undefined;

  return {
    value,
    /*
      X 軸用 insideBottom：標題留在軸自己的高度內，位置因此由 `height` 控制，
      與圖例互不相干。`bottom`（軸外側）會把標題排進圖例佔用的帶狀區域，
      兩者直接疊在一起——這是實機驗過的，不是推測。
    */
    position: axis === "x" ? ("insideBottom" as const) : ("insideLeft" as const),
    angle: axis === "x" ? 0 : -90,
    // insideBottom 把標題貼在軸高度的底緣、與刻度重疊；dy 把它往下推到刻度
    // 之下。推的幅度須讓標題落在軸高度內（見 X_AXIS_HEIGHT_WITH_LABEL），
    // 越過下緣就會撞上圖例——圖例排在軸的外側，位置不受這個 dy 影響。
    ...(axis === "x" ? { dy: 4 } : {}),
    // 兩軸的標題都置中於該軸；insideLeft 預設靠上，旋轉後會變成靠左。
    textAnchor: "middle" as const,
    width: undefined,
    className: "fill-muted-foreground text-xs",
  };
}

/**
 * 散佈圖的圖例項目：各數列，依 `series` 的宣告順序。
 *
 * 自行組 payload 而非讓 recharts 從各 `Scatter` 收集：原生收集出來是**反序**的
 * （實測三數列 甲乙丙 → 丙乙甲），與 `series` 的宣告順序、以及配色對照表的
 * 取色順序都對不上，讀者會把圖例的第一項對到畫面上的另一個顏色。
 *
 * 曾另有一項「大小：{sizeLabel}」標示氣泡維度（見 docs/adr/0007-scatter-static-dimension-labels.md），已依需求移除；
 * `sizeLabel` / `sizeUnit` 改由 Tooltip 單獨承載。
 *
 * 匯出並單獨測試：圖例項目的組成規則不必渲染整張圖就能驗。
 */
export function scatterLegendPayload(
  chart: ScatterChartDefinition,
  palette: ChartPalette
): LegendPayload[] {
  return chart.series.map((s) => ({
    value: s.label ?? s.key,
    type: "circle" as const,
    dataKey: s.key,
    color: seriesColorAt(s, palette),
  }));
}

/**
 * 氣泡大小這個維度交給 `ZAxis` 的標示 props。
 *
 * `ZAxis` 同時承載氣泡幾何（`range`，見 BUBBLE_AREA_RANGE）與 Tooltip 的名稱、
 * 單位；此函式只負責後者。抽成具名函式並單獨測試：`ZAxis` 不渲染任何 DOM，
 * 這兩個值在渲染斷言中驗不到，而 `sizeUnit` 是三個單位裡唯一沒有刻度可依附的，
 * 接錯了畫面上看不出來。
 *
 * 名稱未提供 `sizeLabel` 時回退 `sizeKey`，與 `series[].label` 的既有模式一致。
 */
export function bubbleAxisLabels(chart: ScatterChartDefinition) {
  const { sizeKey, sizeLabel, sizeUnit } = chart;

  return { dataKey: sizeKey, name: sizeLabel ?? sizeKey, unit: sizeUnit };
}

/**
 * 氣泡大小的值域，直接交給 recharts 的 `ZAxis.range`。
 *
 * **單位是面積而非半徑**——recharts 內部以 `r = sqrt(size / π)` 反推半徑，
 * 故 1280 換算後的最大半徑約 20.2px、64 的最小半徑約 4.5px。
 *
 * 兩個數值取自 charts-tpl 的實機驗證（`src/app/charts-tpl/scatter-chart-tpl.tsx`），
 * 不參數化：改用函式庫內建的映射，正是為了不再自訂氣泡幾何。代價是接受兩個
 * 缺陷——中段壓縮（面積線性把中段往高值推）與起算點固定為 0（資料不含 0 時
 * 最小氣泡取不到下界），屬知情取捨。
 */
const BUBBLE_AREA_RANGE: readonly [number, number] = [64, 1280];

/**
 * 面積上界換算回來的最大氣泡半徑（px）。
 *
 * 由 `BUBBLE_AREA_RANGE` 推導而非寫死：兩者散成各自的字面值會在改動時漏改，
 * 而這個值同時決定了繪圖區的邊距（見下方 `SCATTER_CHART_MARGIN`）——
 * 邊距若小於半徑，端點的氣泡就會被 SVG 裁掉半邊。
 */
const MAX_BUBBLE_RADIUS = Math.sqrt(BUBBLE_AREA_RANGE[1] / Math.PI);

/**
 * 散佈圖繪圖區的邊距。
 *
 * 氣泡以資料點為圓心向外擴張，端點的圓會被 SVG 裁掉半邊，故上／右各留一整個
 * 最大半徑（無條件進位——邊距吃的是整數 px，捨去會差那零點幾 px 而露出裁切）。
 * charts-tpl 用的 20 正是這樣差了 0.19px。
 * 左右另有 Y 軸與 X 軸末刻度撐開，下方 10 已足夠。
 */
const SCATTER_CHART_MARGIN = {
  top: Math.ceil(MAX_BUBBLE_RADIUS),
  right: Math.ceil(MAX_BUBBLE_RADIUS),
  bottom: 10,
  left: 10,
} as const;

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
  const { data, xKey, xUnit, yUnit, xLabel, yLabel, series, sizeKey } = chart;
  const palette = useChartPalette();

  // 單一數列時 Y 軸只承載那一個欄位，其名稱即該軸的名稱；多數列時取其一
  // 會對其餘數列說謊，此時圖例已列出各數列名稱，Y 軸不另取名。
  const yAxisName = series.length === 1 ? (series[0].label ?? series[0].key) : undefined;

  return (
    <ScatterChart responsive style={SCATTER_CHART_STYLE} margin={SCATTER_CHART_MARGIN}>
      <CartesianGrid strokeDasharray="3 3" />
      {/*
        三個軸都給 `name` 與選填的 `unit`：散佈圖的軸是純數值，刻度本身不說明
        畫的是什麼。`unit` 接在刻度後面（如 `45元`、`1.2M件`），在**沒有滑鼠
        互動**的情況下即可讀出這個維度是什麼——AI 對話產生的圖表最常見的用法
        是截圖轉貼，Tooltip 在那個情境下完全失效。比照 recharts 官方
        SimpleScatterChart 把資訊拆進刻度與圖例兩處。
      */}
      {/* 標題畫在軸的高度內，需要多留高度，否則會疊在刻度上。 */}
      <XAxis
        type="number"
        dataKey={xKey}
        name={xKey}
        unit={xUnit}
        height={xLabel === undefined ? undefined : X_AXIS_HEIGHT_WITH_LABEL}
        label={axisLabel(xLabel, "x")}
        tickFormatter={formatAxisTick}
      />
      {/* width="auto" 讓軸自行量出刻度文字與標題所需寬度，不必猜一個魔術數字。 */}
      <YAxis
        type="number"
        name={yAxisName}
        unit={yUnit}
        width="auto"
        label={axisLabel(yLabel, "y")}
        tickFormatter={formatAxisTick}
      />
      {sizeKey ? (
        /* 半徑由 recharts 依 `range`（面積）內建映射；同時承載 Tooltip 的名稱與單位。 */
        <ZAxis type="number" range={BUBBLE_AREA_RANGE} {...bubbleAxisLabels(chart)} />
      ) : null}
      <Tooltip />
      {/*
        散佈圖一律顯示圖例，單一數列也不例外。折線圖／長條圖的「單一數列不顯示」
        成立於它們的 X 軸把類別名稱寫在刻度上，Y 軸語意由該脈絡撐住；散佈圖兩軸
        都是裸數字，沒有脈絡可倚靠，單一數列正是最需要圖例的情境。詳見 docs/adr/0007-scatter-static-dimension-labels.md。
      */}
      {/*
        `position` + `layout` 取代已棄用的 `verticalAlign` / `align`。圖例移進繪圖區
        左上角後不再與 X 軸標題爭同一條帶狀區域，舊版為閃避標題而做的 `paddingTop`
        微調因此不必要。
      */}
      {/*
        payload 仍自行組出，理由已不是「追加大小項」（該項已移除），而是**順序**：
        recharts 從各 `Scatter` 原生收集出來的圖例是**反序**的（實測三數列
        甲乙丙 → 丙乙甲），與 `series` 的宣告順序、以及配色對照表的取色順序都對不上。
        自組 payload 讓圖例順序與 `series` 一致。
      */}
      <Legend
        position="top"
        layout="auto"
        content={(props) => (
          <DefaultLegendContent
            {...props}
            payload={scatterLegendPayload(chart, palette)}
          />
        )}
      />
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

/**
 * 各圖表類型的中文名稱。
 *
 * 匯出而非在 `ChartCard` 內部使用：圖種是卡片**外**的標示，由呼叫端決定要不要標、
 * 用什麼層級的標題標——樣板頁需要它來區隔各段，對話串裡的圖表則未必。
 * 名稱沿用 `src/app/chat-tpl/page.tsx` 已在用的措辭，同一個概念不在兩處各叫各的。
 *
 * 用 Record 而非 switch：新增一種圖表時漏了這裡，TypeScript 會直接報錯。
 */
export const CHART_KIND_LABEL: Record<ChartDefinition["type"], string> = {
  line: "折線圖",
  bar: "長條圖",
  area: "區域圖",
  pie: "圓餅圖",
  radar: "雷達圖",
  scatter: "散佈圖",
};

export function ChartCard({ chart }: { chart: ChartDefinition }) {
  return (
    <div data-slot="chart-card" className="w-full rounded-lg border bg-card p-4">
      {chart.title ? (
        <div data-slot="chart-title" className="mb-3 text-sm font-medium">
          {chart.title}
        </div>
      ) : null}
      <ChartBody chart={chart} />
    </div>
  );
}
