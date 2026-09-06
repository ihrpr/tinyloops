import { IconChip } from './icons.jsx';
import { DayLoop, Legend } from './charts/Rhythm.jsx';

// Renders the pre-computed day-summary widget from /api/home: today drawn as
// a 24h loop (when the day has sleeps or feeds to show) above the summary
// rows. All values and labels arrive formatted from the server; this only
// lays them out. `r.k` is the server's icon key for the row.
export function DaySummary({ summary, onEditNursing }) {
  if (summary.empty) {
    return <div className="card" id="summary"><div className="empty-note">{summary.note}</div></div>;
  }
  return (
    <div className="card" id="summary">
      {summary.loop && (
        <div className="sum-loop">
          <DayLoop day={summary.loop} nowMin={summary.loop.nowMin} center={summary.loop.center} />
          {summary.loop.center.breakdown && (
            <div className="loop-breakdown">{summary.loop.center.breakdown}</div>
          )}
          <Legend />
        </div>
      )}
      {summary.rows.map((r, i) => (
        <div className="sum-row" key={i}>
          <IconChip k={r.k} small />
          <span className="lbl">{r.label}{r.ago && <span className="ago"> · {r.ago}</span>}</span>
          <span className="v">{r.value}</span>
        </div>
      ))}
      {summary.note && (
        <div className="sum-note" onClick={onEditNursing}>{summary.note}</div>
      )}
    </div>
  );
}
