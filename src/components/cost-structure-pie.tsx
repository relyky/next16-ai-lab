const COST_STRUCTURE = [
  { label: "人力", percent: 45, colorClass: "bg-primary" },
  { label: "研發", percent: 25, colorClass: "bg-foreground/70" },
  { label: "行銷", percent: 20, colorClass: "bg-muted-foreground/50" },
  { label: "其他", percent: 10, colorClass: "bg-muted-foreground/25" },
] as const;

const SEGMENT_COLORS = ["var(--primary)", "#57534e", "#a8a29e", "#d6d3d1"];

export function CostStructurePie() {
  const stops = COST_STRUCTURE.reduce<{ text: string[]; cumulative: number }>(
    (acc, item, index) => {
      const start = acc.cumulative;
      const end = start + item.percent;
      acc.text.push(`${SEGMENT_COLORS[index]} ${start}% ${end}%`);
      acc.cumulative = end;
      return acc;
    },
    { text: [], cumulative: 0 }
  ).text.join(", ");

  return (
    <div className="flex items-center gap-6">
      <div
        className="h-24 w-24 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
      />
      <ul className="flex flex-col gap-1 text-sm">
        {COST_STRUCTURE.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-sm ${item.colorClass}`} />
            <span className="text-muted-foreground">
              {item.label} {item.percent}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
