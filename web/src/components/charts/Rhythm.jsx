// Day-shape drawing. <Rhythm> is the stats section (stacked week bands +
// week-over-week trend tiles, fed by /api/stats); <DayBand> draws one day as
// a 24h line and is rendered by the home screen's Day summary widget (fed by
// /api/home). Everything numeric — spans, feed minutes, midnight splits, the
// tile maths — arrives precomputed from the server; this file is pure
// drawing (hand-rolled SVG: neither view is a chart Recharts can express).

const MIN_DAY = 1440;

function fmtHm(min) {
  const m = min % MIN_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// `night`: whether night-marked sleep appears in the accompanying chart —
// families who never mark nights keep the single Sleep swatch.
export function Legend({ night }) {
  return (
    <div className="rhythm-legend">
      {night ? (
        <>
          <span><i className="sw night" />Night</span>
          <span><i className="sw sleep" />Nap</span>
        </>
      ) : (
        <span><i className="sw sleep" />Sleep</span>
      )}
      <span><i className="sw feed" />Feed</span>
      <span><i className="sw now" />Now</span>
    </div>
  );
}

const spanFill = (sp) => (sp.night ? 'var(--sleep-night)' : 'var(--accent)');
const spanName = (sp) => (sp.night ? 'Night sleep' : 'Sleep');

/** True when any day's spans carry night-marked sleep. */
export const hasNight = (days) =>
  days.some((day) => day.spans.some((sp) => sp.night));

// ---- one day on a 24h line (the home summary widget) ----

export function DayBand({ day, nowMin }) {
  const W = 380, H = 26, y = 8, x0 = 10, x1 = W - 10, Ht = 58;
  const X = (min) => x0 + (min / MIN_DAY) * (x1 - x0);
  const text = day.spans.length || day.feeds.length
    ? `${day.spans.length} sleeps and ${day.feeds.length} feeds on a 24-hour line`
    : 'nothing logged';
  return (
    <svg className="day-band" viewBox={`0 0 ${W} ${Ht}`} role="img"
      aria-label={`${day.name}: ${text}`}>
      {[0, 6, 12, 18, 24].map((h) => (
        <g key={h}>
          <line x1={X(h * 60)} y1={y - 4} x2={X(h * 60)} y2={y + H + 6}
            stroke="var(--line)" strokeWidth="1" />
          <text x={X(h * 60)} y={Ht - 4} fontSize="10.5" fill="var(--muted)"
            textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {h === 24 ? '24:00' : `${h}:00`}
          </text>
        </g>
      ))}
      <rect x={x0} y={y} width={x1 - x0} height={H} rx={6} fill="var(--chip)" />
      {/* bars, not pills: a short nap must read as a sliver, never a circle */}
      {day.spans.map((sp, i) => (
        <rect key={i} x={X(sp.a)} y={y + 2}
          width={Math.max(X(sp.b) - X(sp.a), 4)} height={H - 4}
          rx={3} fill={spanFill(sp)}>
          <title>{`${spanName(sp)} ${fmtHm(sp.a)}–${fmtHm(sp.b)}`}</title>
        </rect>
      ))}
      {day.feeds.map((m, i) => (
        <circle key={i} cx={X(m)} cy={y + H / 2} r="5" fill="var(--warm)"
          stroke="var(--card)" strokeWidth="1.8">
          <title>{`Feed ${fmtHm(m)}`}</title>
        </circle>
      ))}
      {day.today && (
        <line x1={X(nowMin)} y1={y - 5} x2={X(nowMin)} y2={y + H + 5}
          stroke="var(--warm)" strokeWidth="2.5" strokeLinecap="round">
          <title>{`Now ${fmtHm(nowMin)}`}</title>
        </line>
      )}
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
            <rect x={x0} y={y} width={x1 - x0} height={rowH} rx={4} fill="var(--chip)" />
            {day.spans.map((sp, j) => (
              <rect key={j} x={X(sp.a)} y={y + 1.5}
                width={Math.max(X(sp.b) - X(sp.a), 3)} height={rowH - 3}
                rx={2.5} fill={spanFill(sp)}>
                <title>{`${spanName(sp)} ${fmtHm(sp.a)}–${fmtHm(sp.b)}`}</title>
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
        <Legend night={hasNight(rhythm.days)} />
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
