import { useState } from 'react';
import { IconChip } from './icons.jsx';
import { DayBand, Legend, hasNight } from './charts/Rhythm.jsx';

// The day-summary widget from /api/home: a day drawn as a 24h line on top,
// the summary rows below — the SAME layout for every day. Paging back (the
// server ships the last 7 days in one payload — no extra fetches) swaps in
// that day's rows; only today carries the now-statuses (feeding now, awake
// for…) and the assumed-ml note. All values and labels arrive formatted from
// the server; this only lays them out. `r.k` is the server's icon key.
export function DaySummary({ summary, onEditNursing }) {
  const days = summary.days;
  const [idx, setIdx] = useState(() => (days ? days.length - 1 : 0));
  if (summary.empty) {
    return <div className="card" id="summary"><div className="empty-note">{summary.note}</div></div>;
  }
  const day = days ? days[Math.min(idx, days.length - 1)] : null;
  const rows = day && !day.today ? day.rows : summary.rows;
  return (
    <div className="card" id="summary">
      {day && (
        <div className="sum-day">
          <div className="day-nav">
            <button aria-label="Previous day" disabled={idx === 0}
              onClick={() => setIdx(idx - 1)}>‹</button>
            <span className="day-name">{day.name}</span>
            <button aria-label="Next day" disabled={idx === days.length - 1}
              onClick={() => setIdx(idx + 1)}>›</button>
          </div>
          <DayBand day={day} nowMin={summary.nowMin} />
          {/* legend stays stable while paging: keyed to the whole week */}
          <Legend night={hasNight(days)} />
        </div>
      )}
      {rows.length === 0 && <div className="empty-note">Nothing logged this day.</div>}
      {rows.map((r, i) => r.kind === 'sub' ? (
        <div className="sum-row sub" key={i}>
          <span className="lbl">{r.label}</span>
          <span className="v">{r.value}</span>
        </div>
      ) : (
        <div className="sum-row" key={i}>
          <IconChip k={r.k} small />
          <span className="lbl">{r.label}{r.ago && <span className="ago"> · {r.ago}</span>}</span>
          <span className="v">{r.value}</span>
        </div>
      ))}
      {(!day || day.today) && summary.note && (
        <div className="sum-note" onClick={onEditNursing}>{summary.note}</div>
      )}
    </div>
  );
}
