import { IconChip } from './icons.jsx';

// The today/yesterday list from /api/home, grouped by day. Tapping an entry
// opens the edit modal. Content is server-formatted; React escapes it.
export function EntryList({ list, onEdit }) {
  return (
    <div id="todayList">
      {list.map((group) => (
        <div key={group.day}>
          <div className="day-sep">{group.day}</div>
          {group.entries.map((e) => (
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
      ))}
    </div>
  );
}
