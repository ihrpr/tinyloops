import { useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell,
} from 'recharts';

// Night-stretch explorer: one dot per night (y = longest unbroken stretch),
// x switchable between facts about the day that led into it. Points and the
// worded verdicts come precomputed from /api/stats; this formats ticks and
// draws. Newer nights render darker so "it changed recently" is visible.

const two = (n) => String(n).padStart(2, '0');
const clock = (m) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;
const hrs = (m) => (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${two(m % 60)}`);

const fmtX = (kind, x) =>
  kind === 'clock' ? clock(x)
    : kind === 'clock12' ? clock((x + 720) % 1440) // minutes after noon → wall clock
    : kind === 'dur' ? hrs(x)
    : `${x}ml`;

function Tip({ active, payload, v }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      {p.label}: night {hrs(p.y)} · {v.label.toLowerCase()} {fmtX(v.kind, p.x)}
    </div>
  );
}

export function NightScatter({ explore }) {
  const [key, setKey] = useState('lastNap');
  if (!explore?.any) {
    return explore?.note ? (
      <div className="card">
        <h3>Night stretch vs the day before</h3>
        <div className="empty-note">{explore.note}</div>
      </div>
    ) : null;
  }
  const v = explore.vars.find((o) => o.key === key);
  const pts = explore.nights
    .filter((n) => n[key] != null)
    .map((n) => ({ ...n, x: n[key] }));
  return (
    <div className="card">
      <h3>Night stretch vs the day before</h3>
      <label className="explore-pick">Compare with
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {explore.vars.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 8, right: 10, bottom: 0, left: -4 }}>
          <CartesianGrid stroke="var(--line)" />
          <XAxis dataKey="x" type="number" domain={['dataMin - 20', 'dataMax + 20']}
            tickFormatter={(x) => fmtX(v.kind, Math.round(x))} tickLine={false}
            axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis dataKey="y" type="number" width={44} domain={['dataMin - 30', 'dataMax + 30']}
            tickFormatter={(y) => `${Math.round(y / 60)}h`} tickLine={false}
            axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip content={<Tip v={v} />} cursor={false} isAnimationActive={false} />
          <Scatter data={pts} isAnimationActive={false}>
            {pts.map((p, i) => (
              <Cell key={p.date} fill="var(--accent)"
                fillOpacity={0.35 + 0.65 * (pts.length < 2 ? 1 : i / (pts.length - 1))} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="trend-note">{explore.verdicts[key]}</div>
      <p className="muted chart-note">One dot per night, newer nights darker.
        Patterns here are hints, not causes.</p>
    </div>
  );
}
