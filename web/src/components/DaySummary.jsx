import { useState } from 'react';
import { IconChip } from './icons.jsx';
import { DayBand, TargetBand, Legend, hasNight } from './charts/Rhythm.jsx';

// The day-summary widget: one day drawn as a 24h line on top, the summary
// rows below — the SAME layout for every day. Which day shows is owned by
// the parent (useDay), so the entry list follows the same selection. Paging
// through the recent days is instant (they ship with /api/home); older days
// arrive from /api/days/:date. The day name is also a native date picker,
// bounded by the server's firstDate — jump anywhere the data goes. All
// values, labels and paging pointers arrive formatted from the server; this
// only lays them out. `r.k` is the server's icon key.
export function DaySummary({ summary, day, nav, onEditNursing }) {
  // the by-time scrubber: null = follow the clock (summary.scrubNow). The
  // position survives paging, so other days compare at the same time —
  // day.scrub[slot] is the server's ready-made readout for that step.
  // (Hook first: it must run even on the empty-summary render below.)
  const [scrub, setScrub] = useState(null);
  // dragging onto the Now position hands the marker back to the clock
  const onScrub = (min) => {
    const s = Math.max(0, Math.min(96, Math.round(min / 15)));
    setScrub(s === summary.scrubNow ? null : s);
  };
  if (summary.empty) {
    return <div className="card" id="summary"><div className="empty-note">{summary.note}</div></div>;
  }
  const days = summary.days;
  const today = days[days.length - 1];
  const rows = day ? (day.today ? summary.rows : day.rows) : [];
  const slot = scrub ?? summary.scrubNow;
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
            {/* the plan rides just above the real band, same 24h columns —
                day.plan is the server's "Target: 2 of 4 naps · …" line */}
            {summary.target && day.plan && (
              <>
                <div className="plan-cap">{day.plan}</div>
                <TargetBand target={summary.target} />
              </>
            )}
            {/* the dashed marker IS the scrubber — tap or drag anywhere on
                the band. Untouched, it rides at Now and follows the clock */}
            <DayBand day={day} nowMin={summary.nowMin}
              scrubMin={slot * 15}
              scrubText={day.scrub ? day.scrub[slot] : undefined}
              onScrub={day.scrub ? onScrub : undefined} />
            {day.scrub && (
              <div className="scrub-read">{day.scrub[slot]}</div>
            )}
            {/* legend stays stable while paging: keyed to the shipped days */}
            <Legend now={false}
              night={hasNight([...days, day]) || !!summary.target} />
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
