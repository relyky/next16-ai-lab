const PROFIT_BY_MONTH = [32, 40, 28, 52, 68, 88] as const;

const WIDTH = 280;
const HEIGHT = 100;

export function ProfitTrendLine() {
  const min = Math.min(...PROFIT_BY_MONTH);
  const max = Math.max(...PROFIT_BY_MONTH);
  const range = max - min || 1;
  const step = WIDTH / (PROFIT_BY_MONTH.length - 1);

  const points = PROFIT_BY_MONTH.map((value, index) => {
    const x = index * step;
    const y = HEIGHT - ((value - min) / range) * HEIGHT;
    return { x, y };
  });

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-24 w-full text-primary"
      preserveAspectRatio="none"
    >
      <polyline
        points={linePoints}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, index) => (
        <circle key={index} cx={p.x} cy={p.y} r="3" fill="currentColor" />
      ))}
    </svg>
  );
}
