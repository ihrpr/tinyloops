import { IconChip } from './icons.jsx';

// Running-timer cards (open feeds/sleep/play) from /api/home. Tap the card to
// edit/discard; tap Stop to close it. All labels are server-formatted.
// The ring around the icon is the loop: it circles while the timer runs.
export function OpenTimers({ open, onEdit, onStop }) {
  return (
    <div id="openList">
      {open.map((e) => (
        <div className={'open-card' + (e.stale ? ' is-stale' : '')} key={e.id} onClick={() => onEdit(e.raw)}>
          <span className="ringwrap">
            <svg className="ring" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <circle cx="24" cy="24" r="21.5" stroke="var(--line)" strokeWidth="3" />
              <circle
                className="arc" cx="24" cy="24" r="21.5"
                stroke="var(--warm)" strokeWidth="3" strokeLinecap="round"
                strokeDasharray="88 47"
              />
            </svg>
            <IconChip k={e.type} />
          </span>
          <div className="grow">
            <div className="t-label">{e.label}</div>
            <div className="t-sub">
              {e.stale
                ? <span className="stale">{e.sub}</span>
                : e.sub}
            </div>
          </div>
          <div className="t-elapsed">{e.elapsed}</div>
          <button
            className="stop-btn"
            onClick={(ev) => { ev.stopPropagation(); onStop(e.id); }}
          >Stop</button>
        </div>
      ))}
    </div>
  );
}
