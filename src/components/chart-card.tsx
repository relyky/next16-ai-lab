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
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Sector,
  Symbols,
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
 * 扇形的自訂 shape：逐扇形決定填色。
 *
 * 取代已棄用的 `Cell`——recharts 3.x 標記 `Cell` 為 deprecated 並將於 4.0 移除，
 * 官方替代方案即為此處的 `shape` prop（見 recharts 的 Cell 遷移指南）。
 * `Cell` 被淘汰的理由之一正好也適用於我們：它的 props 依所在圖表而異
 * （Bar 要 Rectangle、Pie 要 Sector），TypeScript 標不出來。
 *
 * 回傳 render function 而非直接當元件用：著色需要的 `nameKey` / `colorKey` /
 * 對照表都不在 recharts 傳進來的 props 裡，得由外層先綁好——與散佈圖的
 * `bubbleShapeRenderer` 同一個模式。
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
 * 氣泡半徑對資料值的映射曲線指數。
 *
 * 半徑正比於正規化資料值的 0.75 次方，是兩個極端之間的折衷：
 * 半徑線性（指數 1）契約最誠實——`range` 說 6–30 就均勻畫 6–30——但放棄了
 * 「面積在感知上正確」，人眼比較圓的大小時比較的是面積，大值會看起來被過度放大；
 * 面積線性（指數 0.5，即 recharts `ZAxis.range` 的內建行為）感知正確，
 * 但 `sqrt` 把中段往高值推，多數真實資料的氣泡因此擠成一團讀不出差異。
 * 詳見 docs/adr/0005。
 */
const BUBBLE_RADIUS_EXPONENT = 0.75;

/**
 * 依資料值算出該氣泡的半徑（px）。
 *
 * 起算點是**資料最小值**而非 0：recharts 內建的 `ZAxis.range` 映射固定從 0 起算，
 * 只有資料恰好含 0 時最小半徑才取得到——那讓 `range` 的「最小半徑」對多數資料集
 * 說謊。此處先把值正規化到 [0, 1] 再套曲線，`range` 的兩端因此恆等於資料兩端。
 *
 * 值域以 tuple 收下而非拆成兩個參數：`bubbleValueExtent` 本來就回傳這個形狀，
 * 拆開只是讓呼叫端多一個把兩個數字傳反的機會。
 *
 * 資料值全部相同（值域兩端相等）時沒有可分辨的大小差異，一律取最小半徑：
 * 取最大半徑會讓一組毫無差異的資料畫出滿版的氣泡，暗示了不存在的高值。
 *
 * 匯出並單獨測試：jsdom 不產生 SVG 幾何，此換算在渲染斷言中驗不到。
 */
export function bubbleRadiusAt(
  value: number,
  extent: readonly [number, number],
  radiusRange: readonly [number, number] = DEFAULT_BUBBLE_RADIUS_RANGE
): number {
  const [dataMin, dataMax] = extent;
  const [minRadius, maxRadius] = radiusRange;
  if (dataMax <= dataMin) return minRadius;

  const normalized = (value - dataMin) / (dataMax - dataMin);
  // 值域外的資料點沒有意義，但夾住可保證半徑不超出契約宣稱的範圍。
  const clamped = Math.min(Math.max(normalized, 0), 1);
  return minRadius + clamped ** BUBBLE_RADIUS_EXPONENT * (maxRadius - minRadius);
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
 * 氣泡大小這個維度交給 `ZAxis` 的標示 props。
 *
 * `ZAxis` 在本圖表已不參與幾何——半徑由 `bubbleShapeRenderer` 決定——它留下來
 * 純粹是為了承載 Tooltip 的名稱與單位。抽成具名函式並單獨測試：`ZAxis` 不渲染
 * 任何 DOM，這兩個值在渲染斷言中驗不到，而 `sizeUnit` 是三個單位裡唯一沒有
 * 刻度可依附的，接錯了畫面上看不出來。
 *
 * 名稱未提供 `sizeLabel` 時回退 `sizeKey`，與 `series[].label` 的既有模式一致。
 */
export function bubbleAxisLabels(chart: ScatterChartDefinition) {
  const { sizeKey, sizeLabel, sizeUnit } = chart;

  return { dataKey: sizeKey, name: sizeLabel ?? sizeKey, unit: sizeUnit };
}

/**
 * 氣泡大小那一項的圖例圖示：中性的空心圓。
 *
 * 刻意不上色也不填滿：這一項表達的是「大小」而非「顏色」，與數列的實心色圓
 * 在視覺上必須區分得開，否則讀者會把它讀成第四組數列。以 `currentColor` 描邊，
 * 深淺色主題下都跟著文字色走。
 *
 * 幾何數字用的是 recharts 圖例 svg 的 **viewBox** 邊長（`0 0 32 32`），而非它
 * 顯示出來的 14px 寬度——`legendIcon` 的內容畫在 viewBox 座標裡。用 14 會讓
 * 圖示只有四成大小且偏左，實機看起來像一個辨識不出形狀的小點。
 */
const LEGEND_ICON_SIZE = 32;

function BubbleLegendIcon() {
  const half = LEGEND_ICON_SIZE / 2;
  return (
    <g className="recharts-legend-icon">
      {/*
        兩個同心圓表達的是「大小是一個會變動的維度」，單一個圓只會被讀成
        一個普通的點。外圈虛線是那個維度的上界，實心小圓是下界。
      */}
      <circle
        cx={half}
        cy={half}
        r={half - 2}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeDasharray="5 3.5"
        opacity={0.8}
      />
      <circle cx={half} cy={half} r={5} fill="currentColor" opacity={0.8} />
    </g>
  );
}

/**
 * 散佈圖的圖例項目：各數列之後，`sizeKey` 提供時再追加一項「大小」。
 *
 * 氣泡大小是三個維度中唯一沒有軸刻度可依附的，圖例是它唯一的靜態標示管道。
 * 詳見 docs/adr/0006。
 *
 * 自行組 payload 而非讓 recharts 從各 `Scatter` 收集：追加的「大小」項不對應
 * 任何一個 `Scatter`，沒有地方掛得上去。自行組同時也讓數列項與大小項的順序
 * 明確可控。
 *
 * 匯出並單獨測試：圖例項目的組成規則不必渲染整張圖就能驗。
 */
export function scatterLegendPayload(
  chart: ScatterChartDefinition,
  palette: ChartPalette
): LegendPayload[] {
  const { series, sizeKey, sizeLabel } = chart;

  const seriesItems = series.map((s) => ({
    value: s.label ?? s.key,
    type: "circle" as const,
    dataKey: s.key,
    color: seriesColorAt(s, palette),
  }));

  if (sizeKey === undefined) return seriesItems;

  return [
    ...seriesItems,
    {
      value: `大小：${sizeLabel ?? sizeKey}`,
      type: "circle" as const,
      dataKey: sizeKey,
      // 文字色跟著主題走；圖示自身由 legendIcon 覆寫成空心圓。
      color: "currentColor",
      legendIcon: <BubbleLegendIcon />,
    },
  ];
}

/**
 * 掃出 `sizeKey` 欄位的值域，供半徑映射的正規化使用。
 *
 * 非數值的列已由 tool 端擋下，此處只需忽略——前端不重複那條驗證。
 * 沒有任何數值時回傳 undefined，呼叫端據此退回 recharts 的預設尺寸。
 */
function bubbleValueExtent(
  data: readonly Record<string, string | number>[],
  sizeKey: string
): [number, number] | undefined {
  const values = data
    .map((row) => row[sizeKey])
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;

  return [Math.min(...values), Math.max(...values)];
}

/**
 * 氣泡的自訂 shape：以我們自己算出的半徑覆蓋 recharts 內建的映射。
 *
 * 不能只靠 `ZAxis.range`——recharts 內部是「線性映射到面積後再開根號還原半徑」，
 * 曲線固定為面積線性，且起算點固定為 0，兩者都是 docs/adr/0005 記錄的缺陷。
 * 這裡改成自己決定半徑，`ZAxis` 只留下來承載 Tooltip 需要的名稱與單位。
 *
 * 回傳一個 render function 而非直接當元件用：recharts 把資料點的所有屬性
 * 攤平成 props 傳進來，半徑要用的原始值只在 `payload` 裡，得由外層先綁好
 * 值域與範圍才算得出來。
 *
 * `size`（面積）、`width`/`height`（直徑）、`x`/`y`（外接框左上角）全部一起覆寫：
 * recharts 依 `size` 畫路徑，其餘四項則是它算給資料點的外接框，不同步蓋掉的話
 * 畫出來的圓與它自認的幾何會對不上——測試正是讀 `width` 來驗半徑的。
 */
function bubbleShapeRenderer(
  sizeKey: string,
  extent: readonly [number, number],
  range: readonly [number, number] | undefined
) {
  return function BubbleSymbol(props: object) {
    const { cx, cy, payload, ...rest } = props as {
      cx?: number;
      cy?: number;
      payload: Record<string, string | number>;
    } & Record<string, unknown>;

    const radius = bubbleRadiusAt(Number(payload[sizeKey]), extent, range);

    return (
      <Symbols
        {...rest}
        cx={cx}
        cy={cy}
        type="circle"
        size={Math.PI * radius * radius}
        width={2 * radius}
        height={2 * radius}
        x={cx == null ? undefined : cx - radius}
        y={cy == null ? undefined : cy - radius}
      />
    );
  };
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
  const { data, xKey, xUnit, yUnit, xLabel, yLabel, series, sizeKey, range } = chart;
  const palette = useChartPalette();

  // 單一數列時 Y 軸只承載那一個欄位，其名稱即該軸的名稱；多數列時取其一
  // 會對其餘數列說謊，此時圖例已列出各數列名稱，Y 軸不另取名。
  const yAxisName = series.length === 1 ? (series[0].label ?? series[0].key) : undefined;

  const extent = sizeKey ? bubbleValueExtent(data, sizeKey) : undefined;

  return (
    <ScatterChart margin={bubbleMargin(sizeKey, range)}>
      <CartesianGrid strokeDasharray="3 3" />
      {/*
        三個軸都給 `name` 與選填的 `unit`：散佈圖的軸是純數值，刻度本身不說明
        畫的是什麼。`unit` 接在刻度後面（如 `45元`、`1.2M件`），在**沒有滑鼠
        互動**的情況下即可讀出這個維度是什麼——AI 對話產生的圖表最常見的用法
        是截圖轉貼，Tooltip 在那個情境下完全失效。比照 recharts 官方
        SimpleScatterChart 把資訊拆進刻度與圖例兩處。

        不用旋轉的軸標題：recharts 的 Label 依水平可用寬度自動斷詞，
        中文旋轉後會被折成一字一行，與函式庫對抗不划算。
      */}
      {/* height="auto" 讓 X 軸把標題的高度算進去，否則標題會疊在刻度上。 */}
      {/* 標題畫在軸外側，需要多留高度，否則會被 SVG 下緣裁掉。 */}
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
        /*
          半徑改由 BubbleSymbol 自行決定，故不給 `range`——留著只會讓讀者
          以為半徑是它算的。`ZAxis` 在此純粹承載 Tooltip 的名稱與單位。
        */
        <ZAxis type="number" {...bubbleAxisLabels(chart)} />
      ) : null}
      <Tooltip />
      {/*
        散佈圖一律顯示圖例，單一數列也不例外。折線圖／長條圖的「單一數列不顯示」
        成立於它們的 X 軸把類別名稱寫在刻度上，Y 軸語意由該脈絡撐住；散佈圖兩軸
        都是裸數字，沒有脈絡可倚靠，單一數列正是最需要圖例的情境。詳見 docs/adr/0006。
      */}
      {/*
        有 X 軸標題時把圖例往下讓：標題排在軸高度的底部，圖例的預設位置會與它
        重疊約數 px。實機量過——標題下緣 189、圖例上緣 186。
      */}
      <Legend
        wrapperStyle={xLabel === undefined ? undefined : { paddingTop: 12 }}
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
          shape={
            extent && sizeKey ? bubbleShapeRenderer(sizeKey, extent, range) : undefined
          }
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
