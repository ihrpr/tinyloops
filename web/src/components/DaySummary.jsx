import { IconChip } from './icons.jsx';
import { DayBand, Legend, hasNight } from './charts/Rhythm.jsx';

// The day-summary widget: one day drawn as a 24h line on top, the summary
// rows below — the SAME layout for every day. Which day shows is owned by
// the parent (useDay), so the entry list follows the same selection. Paging
// through the recent days is instant (they ship with /api/home); older days
// arrive from /api/days/:date. The day name is also a native date picker,
// bounded by the server's firstDate — jump anywhere the data goes. All
// values, labels and paging pointers arrive formatted from the server; this
// only lays them out. `r.k` is the server's icon key.
export function DaySummary({ summary, day, nav, onEditNursing }) {
  if (summary.empty) {
    return <div className="card" id="summary"><div className="empty-note">{summary.note}</div></div>;
  }
  const days = summary.days;
  const today = days[days.length - 1];
  const rows = day ? (day.today ? summary.rows : day.rows) : [];
  return (
    <div className="card" id="summary">
      <div className="sum-day">
        <div className="day-nav">
          <button aria-label="Previous day" disabled={!day?.prev}
            onClick={nav.prev}>‹</button>
          <span className="day-name">
            {day ? `${day.name}${day.mood ? ` ${day.mood}` : ''}` : '…'}
            <span className="day-caret" aria-hidden="true">▾</span>
            {/* invisible overlay: tapping the name opens the OS date picker.
                Mobile opens it from any tap; desktop only opens it from the
                (invisible) calendar icon, hence the explicit showPicker() */}
            <input type="date" aria-label="Pick a day"
              value={day ? day.date : today.date}
              min={summary.firstDate} max={today.date}
              onClick={(e) => { try { e.target.showPicker?.(); } catch { /* keeps focus; arrows still work */ } }}
              onChange={(e) => { if (e.target.value) nav.go(e.target.value); }} />
          </span>
          <button aria-label="Next day" disabled={day ? !day.next : false}
            onClick={nav.next}>›</button>
        </div>
        {day && (
          <>
            <DayBand day={day} nowMin={summary.nowMin} />
            {/* legend stays stable while paging: keyed to the shipped days */}
            <Legend night={hasNight([...days, day])} />
          </>
        )}
      </div>
      {!day && <div className="empty-note">{nav.error || 'Loading that day…'}</div>}
      {day && rows.length === 0 && <div className="empty-note">Nothing logged this day.</div>}
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
      {day?.today && summary.note && (
        <div className="sum-note" onClick={onEditNursing}>{summary.note}</div>
      )}
    </div>
  );
}
