// Running-timer cards (open feeds/sleep/play) from /api/home. Tap the card to
// edit/discard; tap Stop to close it. All labels are server-formatted.
export function OpenTimers({ open, onEdit, onStop }) {
  return (
    <div id="openList">
      {open.map((e) => (
        <div className={'open-card' + (e.stale ? ' is-stale' : '')} key={e.id} onClick={() => onEdit(e.raw)}>
          <span className={'icn t-' + e.type}>{e.emoji}</span>
          <div className="grow">
            <div className="t-label">{e.label}</div>
            <div className="t-sub">
              {e.stale
                ? <span className="stale">{e.sub}</span>
                : <><span className="live-dot"></span>{e.sub}</>}
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
