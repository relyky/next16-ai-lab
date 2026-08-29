"use client";

/**
 * 散佈圖樣板：charts-tpl 的實驗場元件。
 *
 * 目的是在乾淨的環境裡試 recharts 3.x 的新 API，驗證後再回頭改 chart-card.tsx。
 * 目前正在試的：
 * - `responsive` prop（取代 chart-card 仍在用的 ResponsiveContainer）
 * - `YAxis width="auto"`
 * - `Legend position="insideTopLeft"`（舊的 verticalAlign/align 已標記 deprecated）
 *
 * 資料先寫死，把心中的圖表樣貌跑出來優先；參數化之後再說。
 */
import {
  CartesianGrid,
  LabelList,
  Legend,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

const SCHOOL_A = [
  { x: 100, y: 200, z: 200 },
  { x: 50, y: 50, z: 100 },
  { x: 75, y: 75, z: 900 },
  { x: 120, y: 100, z: 260 },
  { x: 170, y: 300, z: 400 },
  { x: 140, y: 250, z: 280 },
  { x: 150, y: 400, z: 500 },
  { x: 110, y: 280, z: 200 },
];

const SCHOOL_B = [
  { x: 75, y: 200, z: 200 },
  { x: 150, y: 150, z: 100 },
  { x: 200, y: 75, z: 900 },
];

export function ScatterChartTpl() {
  return (
    <ScatterChart
      style={{ width: "100%", maxWidth: "700px", maxHeight: "70vh", aspectRatio: 1 }}
      responsive
      margin={{ top: 20, right: 20, bottom: 10, left: 10 }}
    >
      <CartesianGrid />
      <XAxis
        type="number"
        dataKey="x"
        name="stature"
        unit="cm"
        label={{ value: "stature", position: "insideBottom", offset: -10 }}
      />
      <YAxis
        type="number"
        dataKey="y"
        name="weight"
        unit="kg"
        width="auto"
        label={{ value: "weight", angle: -90, position: "insideLeft" }}
      />
      <ZAxis type="number" dataKey="z" range={[64, 1280]} />
      <Tooltip />
      <Legend position="insideTopLeft" layout="vertical" offset={8} />
      <Scatter name="A school" data={SCHOOL_A} fill="lightgreen">
        <LabelList dataKey="z" />
      </Scatter>
      <Scatter name="B school" data={SCHOOL_B} fill="cyan">
        <LabelList dataKey="z" />
      </Scatter>
    </ScatterChart>
  );
}
