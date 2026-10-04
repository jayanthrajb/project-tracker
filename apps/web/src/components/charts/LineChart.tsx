import type { ChartDatum } from './BarChart';

export function LineChart({ data, ariaLabel }: { data: ChartDatum[]; ariaLabel: string }) {
  const width = 640;
  const height = 240;
  const left = 24;
  const right = width - 24;
  const top = 20;
  const bottom = 184;
  const max = Math.max(1, ...data.map((point) => point.value));
  const points = data.map((point, index) => {
    const x = data.length === 1 ? width / 2 : left + (index / (data.length - 1)) * (right - left);
    const y = bottom - (point.value / max) * (bottom - top);
    return { ...point, x, y };
  });
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div>
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#cbd5e1" />
        {points.length > 1 && <polyline points={points.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke="#475569" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4" fill="#334155">
              <title>{`${point.label}: ${point.value}`}</title>
            </circle>
            {(index % labelEvery === 0 || index === points.length - 1) && (
              <text x={point.x} y={bottom + 20} textAnchor="middle" className="fill-slate-500 text-[10px]">{point.label}</text>
            )}
          </g>
        ))}
      </svg>
      <table className="sr-only" aria-label={`${ariaLabel} data`}>
        <caption>{ariaLabel} data</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
        <tbody>{data.map((point, index) => <tr key={`${point.label}-${index}`}><th scope="row">{point.label}</th><td>{point.value}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
