import { useState } from 'react';
import { api } from '../api.js';
import { IconChip } from './icons.jsx';

// Shared settings (nursing ml + which activities show), stored in the sheet's
// Settings tab. types comes from home.types; initial values from home.settings.
const hm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function SettingsModal({ home, run, onError, onClose }) {
  const [ml, setMl] = useState(home.settings.breastfeedMl);
  const [selected, setSelected] = useState(() => new Set(home.settings.enabledTypes));
  const [nightStart, setNightStart] = useState(() => hm(home.settings.nightStartMin ?? 1170));
  const [nightEnd, setNightEnd] = useState(() => hm(home.settings.nightEndMin ?? 450));
  const [busy, setBusy] = useState(false);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!(Number(ml) > 0)) return onError('Please enter the nursing amount in ml.');
    if (selected.size === 0) return onError('Keep at least one activity visible.');
    if (!nightStart || !nightEnd) return onError('Please set the night start and end times.');
    setBusy(true);
    const resp = await run(() => api('/api/settings', {
      method: 'PUT',
      body: { breastfeedMl: Number(ml), enabledTypes: [...selected], nightStart, nightEnd },
    }), onError);
    setBusy(false);
    if (resp) onClose();
  }

  return (
    <div id="settingsOverlay" onClick={(e) => { if (e.target.id === 'settingsOverlay') onClose(); }}>
      <div id="settingsModal">
        <h2>Settings</h2>
        <label className="f">Approximate nursing amount (ml)
          <input type="number" inputMode="numeric" min="1" value={ml}
            onChange={(e) => setMl(e.target.value)} /></label>
        <p className="muted hint">Each breastfeed counts as this much in the milk totals.</p>
        <div className="modal-sub">Night time</div>
        <div className="night-range">
          <label className="f">From
            <input type="time" value={nightStart}
              onChange={(e) => setNightStart(e.target.value)} /></label>
          <label className="f">Until
            <input type="time" value={nightEnd}
              onChange={(e) => setNightEnd(e.target.value)} /></label>
        </div>
        <p className="muted hint">Sleeps started in this window are logged as
          Night by default; it also frames the night stats.</p>
        <div className="modal-sub">Show in quick log</div>
        <div className="type-grid">
          {home.types.map((t) => (
            <button
              key={t.key}
              className={'type-btn' + (selected.has(t.key) ? ' on' : '')}
              onClick={() => toggle(t.key)}
            >
              <IconChip k={t.key} />
              <span>{t.short}</span>
            </button>
          ))}
        </div>
        <p className="muted hint">Hidden activities disappear from logging and the
          day summary — existing entries stay untouched.</p>
        <div className="modal-actions">
          <button className="cancel" onClick={onClose}>Cancel</button>
          <button className="save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
