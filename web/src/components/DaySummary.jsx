import { IconChip } from './icons.jsx';

// Renders the pre-computed day-summary rows from /api/home. All values and
// labels arrive formatted from the server; this only lays them out. `r.k` is
// the server's icon key for the row.
export function DaySummary({ summary, onEditNursing }) {
  if (summary.empty) {
    return <div className="card" id="summary"><div className="empty-note">{summary.note}</div></div>;
  }
  return (
    <div className="card" id="summary">
      {summary.rows.map((r, i) => r.kind === 'sub' ? (
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
      {summary.note && (
        <div className="sum-note" onClick={onEditNursing}>{summary.note}</div>
      )}
    </div>
  );
}
