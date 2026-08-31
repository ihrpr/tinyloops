import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

// One growth measure against the WHO reference: five centile curves in muted
// ink (median emphasized), the baby's measurements as a warm line with dots.
// The server sends everything positioned — curve rows and measurement rows
// share one x-sorted data array, so the tooltip and dots need no client math.
function GrowthTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { tip } = payload[0].payload;
  return tip ? <div className="chart-tip">{tip}</div> : null;
}

// direct label at the right end of each centile curve, instead of a legend
const endLabel = (lastIndex, text) => function CentileEndLabel(props) {
  if (props.index !== lastIndex) return null;
  return (
    <text x={props.x + 4} y={props.y + 3} className="centile-label">{text}</text>
  );
};

export function GrowthChart({ chart }) {
  const last = chart.data.length - 1;
  return (
    <>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={chart.data} margin={{ top: 6, right: 36, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--line)" />
          <XAxis dataKey="x" type="number" domain={[0, chart.xMax]} ticks={chart.xTicks}
            tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis domain={chart.yDomain} ticks={chart.yTicks} width={44}
            tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip content={<GrowthTooltip />} cursor={{ stroke: 'var(--line)' }} />
          {chart.centiles.map((cnt) => (
            <Line key={cnt.key} dataKey={cnt.key} stroke="var(--muted)"
              strokeWidth={cnt.key === 'p50' ? 1.7 : 1}
              strokeOpacity={cnt.key === 'p50' ? 0.85 : 0.5}
              dot={false} activeDot={false} isAnimationActive={false}
              label={endLabel(last, cnt.label)} />
          ))}
          <Line dataKey="y" connectNulls stroke="var(--warm)" strokeWidth={2.5}
            dot={{ r: 3.5, fill: 'var(--warm)', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: 'var(--warm)', stroke: 'var(--card)', strokeWidth: 2 }}
            isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="chart-x-caption">age in months</div>
    </>
  );
}
