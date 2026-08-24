const REVENUE_BY_QUARTER = [
  { quarter: "Q1", heightClass: "h-10" },
  { quarter: "Q2", heightClass: "h-12" },
  { quarter: "Q3", heightClass: "h-14" },
  { quarter: "Q4", heightClass: "h-20" },
] as const;

export function QuarterlyRevenueBars() {
  return (
    <div className="flex items-end gap-2">
      {REVENUE_BY_QUARTER.map(({ quarter, heightClass }, index) => (
        <div key={quarter} className="flex flex-col items-center gap-1">
          <div
            className={`w-8 rounded-t-sm ${heightClass} ${
              index === REVENUE_BY_QUARTER.length - 1
                ? "bg-primary"
                : "bg-muted-foreground/40"
            }`}
          />
          <span className="text-xs text-muted-foreground">{quarter}</span>
        </div>
      ))}
    </div>
  );
}
