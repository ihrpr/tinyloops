import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

// Pumped per day (bars) with a least-squares trend line. The server supplies
// the trend endpoints (pump.trend.y0/y1); we spread them linearly across the
// days so Recharts can draw the line in the same coordinate space as the bars.
function PumpTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip">{payload[0].payload.pumpDetail}</div>;
}

export function PumpChart({ days, trend, any }) {
  const n = days.length;
  const data = days.map((d, i) => ({
    ...d,
    trend: any ? trend.y0 + ((trend.y1 - trend.y0) * i) / Math.max(1, n - 1) : null,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -4 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false}
          tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} width={44}
          tick={{ fontSize: 11, fill: 'var(--muted)' }} />
        <Tooltip content={<PumpTooltip />} cursor={{ fill: 'var(--chip)' }} />
        <Bar dataKey="pumpMl" name="Pumped" fill="var(--s2)" radius={[3, 3, 0, 0]} maxBarSize={40}
          isAnimationActive={false} />
        {any && (
          <Line dataKey="trend" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3"
            dot={false} isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
