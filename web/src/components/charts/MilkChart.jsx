import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';

// Milk per day, stacked: breastfed (approx) / bottle milk / formula.
// The server sends per-day ml; Recharts handles scaling, axes and labels.
const SERIES = [
  { key: 'bfMl', name: 'Breastfed (≈)', color: 'var(--s1)' },
  { key: 'bmMl', name: 'Bottle milk', color: 'var(--s2)' },
  { key: 'fMl', name: 'Formula', color: 'var(--s3)' },
];

function MilkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tip">{payload[0].payload.milkDetail}</div>;
}

export function MilkChart({ days, any }) {
  if (!any) {
    return <div className="empty-note">No feeds or bottles logged in this range yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false}
          tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} width={44}
          tick={{ fontSize: 11, fill: 'var(--muted)' }} />
        <Tooltip content={<MilkTooltip />} cursor={{ fill: 'var(--chip)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {SERIES.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="milk" fill={s.color}
            radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={40}
            isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
