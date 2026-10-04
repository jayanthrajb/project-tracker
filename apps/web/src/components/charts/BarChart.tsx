export interface ChartDatum {
  label: string;
  value: number;
}

export function BarChart({ data, ariaLabel }: { data: ChartDatum[]; ariaLabel: string }) {
  const width = 640;
  const height = 240;
  const top = 24;
  const baseline = 184;
  const max = Math.max(1, ...data.map((point) => point.value));
  const slot = width / Math.max(data.length, 1);

  return (
    <div>
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
        <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="#cbd5e1" />
        {data.map((point, index) => {
          const barWidth = Math.min(44, slot * 0.62);
          const barHeight = (point.value / max) * (baseline - top);
          const x = index * slot + (slot - barWidth) / 2;
          const labelEvery = Math.max(1, Math.ceil(data.length / 8));
          return (
            <g key={`${point.label}-${index}`}>
              <rect x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx="3" fill="#475569">
                <title>{`${point.label}: ${point.value}`}</title>
              </rect>
              {data.length <= 12 && <text x={x + barWidth / 2} y={Math.max(16, baseline - barHeight - 6)} textAnchor="middle" className="fill-slate-700 text-[11px]">{point.value}</text>}
              {(index % labelEvery === 0 || index === data.length - 1) && (
                <text x={index * slot + slot / 2} y={baseline + 20} textAnchor="middle" className="fill-slate-500 text-[10px]">{point.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only" aria-label={`${ariaLabel} data`}>
        <caption>{ariaLabel} data</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
        <tbody>{data.map((point, index) => <tr key={`${point.label}-${index}`}><th scope="row">{point.label}</th><td>{point.value}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
