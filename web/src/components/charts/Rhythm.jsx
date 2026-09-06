// Day-shape drawing. <Rhythm> is the stats section (stacked week bands +
// week-over-week trend tiles, fed by /api/stats); <DayLoop> draws a day as a
// 24h clock and is rendered by the home screen's Day summary widget (fed by
// /api/home). Everything numeric — spans, feed minutes, midnight splits, the
// tile maths — arrives precomputed from the server; this file is pure
// drawing (hand-rolled SVG: neither view is a chart Recharts can express).

const MIN_DAY = 1440;

function fmtHm(min) {
  const m = min % MIN_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function Legend() {
  return (
    <div className="rhythm-legend">
      <span><i className="sw sleep" />Sleep</span>
      <span><i className="sw feed" />Feed</span>
      <span><i className="sw now" />Now</span>
    </div>
  );
}

// ---- today's loop (24h clock, midnight at the top) ----

// 344, not 320: the 18:00/6:00 labels sit at ±152 from centre and need
// ~16px of half-width beyond that to avoid clipping at the viewBox edge
const S = 344, CX = S / 2, CY = S / 2, R = 118, RING = 26;
const ang = (min) => (min / MIN_DAY) * Math.PI * 2 - Math.PI / 2;
const pt = (min, r) => [CX + r * Math.cos(ang(min)), CY + r * Math.sin(ang(min))];

function Arc({ a, b }) {
  const [x1, y1] = pt(a, R);
  const [x2, y2] = pt(b, R);
  return (
    <path
      d={`M ${x1} ${y1} A ${R} ${R} 0 ${(b - a) / MIN_DAY > 0.5 ? 1 : 0} 1 ${x2} ${y2}`}
      fill="none" stroke="var(--accent)" strokeWidth={RING - 6} strokeLinecap="round"
    >
      <title>{`Sleep ${fmtHm(a)}–${fmtHm(b)}`}</title>
    </path>
  );
}

export function DayLoop({ day, nowMin, center }) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const big = h % 6 === 0;
    const [x1, y1] = pt(h * 60, R + RING / 2 + 2);
    const [x2, y2] = pt(h * 60, R + RING / 2 + (big ? 8 : 4));
    hours.push(<line key={h} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={big ? 'var(--muted)' : 'var(--line)'} strokeWidth={big ? 1.6 : 1} />);
    if (big) {
      const [lx, ly] = pt(h * 60, R + RING / 2 + 21);
      hours.push(<text key={'t' + h} x={lx} y={ly + 4} textAnchor="middle"
        fontSize="11" fill="var(--muted)">{h}:00</text>);
    }
  }
  const [nx1, ny1] = pt(nowMin, R - RING / 2 - 4);
  const [nx2, ny2] = pt(nowMin, R + RING / 2 + 1);
  const centerText = center.lines
    .map((l) => l.label + (l.value ? ` ${l.value}` : '')).join(', ');
  return (
    <svg className="rhythm-loop" viewBox={`0 0 ${S} ${S}`} role="img"
      aria-label={`Today: ${centerText}`}>
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--chip)" strokeWidth={RING} />
      {hours}
      {day.spans.map((sp, i) => <Arc key={i} a={sp.a} b={sp.b} />)}
      {day.feeds.map((m, i) => {
        const [x, y] = pt(m, R);
        return (
          <circle key={i} cx={x} cy={y} r="5.5" fill="var(--warm)"
            stroke="var(--card)" strokeWidth="2">
            <title>{`Feed ${fmtHm(m)}`}</title>
          </circle>
        );
      })}
      <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} stroke="var(--warm)"
        strokeWidth="2.5" strokeLinecap="round">
        <title>{`Now ${fmtHm(nowMin)}`}</title>
      </line>
      {/* day totals, one line per activity, vertically centred as a block */}
      {center.lines.map((l, i) => (
        <text key={l.label} x={CX} textAnchor="middle" fontSize="14"
          fontFamily="var(--display)"
          y={CY + (i - (center.lines.length - 1) / 2) * 23 + 5}>
          <tspan fill="var(--muted)">{l.label}</tspan>
          {l.value && <tspan fill="var(--ink)" fontWeight="800">{'  ' + l.value}</tspan>}
        </text>
      ))}
    </svg>
  );
}

// ---- the week, one 24h band per day ----

function WeekBands({ days, nowMin }) {
  const W = 380, rowH = 15, gap = 12, x0 = 44, x1 = W - 8;
  const H = 20 + days.length * (rowH + gap);
  const X = (min) => x0 + (min / MIN_DAY) * (x1 - x0);
  return (
    <svg className="rhythm-week" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Sleeps and feeds over the last 7 days, one row per day">
      {[0, 6, 12, 18, 24].map((h) => (
        <g key={h}>
          <line x1={X(h * 60)} y1={14} x2={X(h * 60)} y2={H - 8}
            stroke="var(--line)" strokeWidth="1" />
          <text x={X(h * 60)} y={10} textAnchor="middle" fontSize="10"
            fill="var(--muted)">{h % 24}</text>
        </g>
      ))}
      {days.map((day, i) => {
        const y = 20 + i * (rowH + gap);
        return (
          <g key={day.date}>
            <text x={x0 - 7} y={y + rowH - 4} textAnchor="end" fontSize="10.5"
              fill={day.today ? 'var(--ink)' : 'var(--muted)'}
              fontWeight={day.today ? 700 : 400}>{day.name}</text>
            <rect x={x0} y={y} width={x1 - x0} height={rowH} rx={rowH / 2} fill="var(--chip)" />
            {day.spans.map((sp, j) => (
              <rect key={j} x={X(sp.a)} y={y + 1.5}
                width={Math.max(X(sp.b) - X(sp.a), rowH - 3)} height={rowH - 3}
                rx={(rowH - 3) / 2} fill="var(--accent)">
                <title>{`Sleep ${fmtHm(sp.a)}–${fmtHm(sp.b)}`}</title>
              </rect>
            ))}
            {day.feeds.map((m, j) => (
              <circle key={j} cx={X(m)} cy={y + rowH / 2} r="3.4" fill="var(--warm)"
                stroke="var(--card)" strokeWidth="1.4">
                <title>{`Feed ${fmtHm(m)}`}</title>
              </circle>
            ))}
            {day.today && (
              <line x1={X(nowMin)} y1={y - 4} x2={X(nowMin)} y2={y + rowH + 4}
                stroke="var(--warm)" strokeWidth="2" strokeLinecap="round" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---- the section Stats renders ----

export function Rhythm({ rhythm }) {
  if (!rhythm?.any) return null;
  return (
    <>
      <div className="card">
        <h3>Last 7 days</h3>
        <WeekBands days={rhythm.days} nowMin={rhythm.nowMin} />
        <Legend />
      </div>
      {rhythm.tiles.length > 0 && (
        <div className="rhythm-tiles">
          {rhythm.tiles.map((t) => (
            <div className="tile" key={t.label}>
              <div className="tile-k">{t.label}</div>
              <div className="tile-v">{t.value}</div>
              {t.delta && <div className="tile-d">{t.delta}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
