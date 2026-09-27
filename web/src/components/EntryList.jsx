import { IconChip } from './icons.jsx';

// The entry list for the selected day (default today) — it follows the Day
// summary's selection. Tapping an entry opens the edit modal. Content is
// server-formatted; React escapes it.
export function EntryList({ day, onEdit }) {
  if (!day) return null; // loading an older day — the summary card says so
  return (
    <div id="todayList">
      {day.entries.length === 0 && (
        <div className="empty-note">Nothing logged this day.</div>
      )}
      {day.entries.map((e) => (
        <div className="evt" key={e.id} onClick={() => onEdit(e.raw)}>
          <IconChip k={e.type} />
          <div className="grow">
            <div className="e-label">{e.label}</div>
            <div className="e-sub">{e.details}</div>
          </div>
          <div className="e-time"><b>{e.time}</b>{e.dur}</div>
          <span className="chev" aria-hidden="true">›</span>
        </div>
      ))}
    </div>
  );
}
