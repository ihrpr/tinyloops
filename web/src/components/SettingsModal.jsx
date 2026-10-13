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
  const [targetNaps, setTargetNaps] = useState(home.settings.targetNaps || '');
  const [targetFeeds, setTargetFeeds] = useState(home.settings.targetFeeds || '');
  // the plan builder: counts default to the current plan's sizes (echoed by
  // the server) so Build starts from what the family already does
  const [buildNaps, setBuildNaps] = useState(String(home.settings.targetNapCount || 4));
  const [buildFeeds, setBuildFeeds] = useState(String(home.settings.targetFeedCount || 8));
  const [dreamFeed, setDreamFeed] = useState(false);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // the server spaces the day out and returns the two canonical strings;
  // this only drops them into the fields below for tweaking, then Save
  // stores them like hand-typed ones. A read, not a write — so it skips
  // `run` (the write path) and works in demo mode too.
  async function buildPlan() {
    setBuilding(true);
    try {
      const q = new URLSearchParams({ naps: buildNaps || '0', feeds: buildFeeds || '0',
        dreamFeed: dreamFeed ? '1' : '0', nightStart, nightEnd });
      const resp = await api(`/api/target-plan?${q}`);
      setTargetNaps(resp.targetNaps);
      setTargetFeeds(resp.targetFeeds);
    } catch (e) {
      onError(e.message); // the server's message names what to fix
    }
    setBuilding(false);
  }

  async function save() {
    if (!(Number(ml) > 0)) return onError('Please enter the nursing amount in ml.');
    if (selected.size === 0) return onError('Keep at least one activity visible.');
    if (!nightStart || !nightEnd) return onError('Please set the night start and end times.');
    setBusy(true);
    const resp = await run(() => api('/api/settings', {
      method: 'PUT',
      body: { breastfeedMl: Number(ml), enabledTypes: [...selected], nightStart, nightEnd,
        targetNaps, targetFeeds },
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
        <div className="modal-sub">Target day (optional)</div>
        <div className="plan-build">
          <label className="f">Naps
            <input type="number" inputMode="numeric" min="0" max="8" value={buildNaps}
              onChange={(e) => setBuildNaps(e.target.value)} /></label>
          <label className="f">Feeds
            <input type="number" inputMode="numeric" min="0" max="16" value={buildFeeds}
              onChange={(e) => setBuildFeeds(e.target.value)} /></label>
          <button className="build-btn" disabled={building} onClick={buildPlan}>
            {building ? 'Building…' : 'Build'}</button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={dreamFeed}
            onChange={(e) => setDreamFeed(e.target.checked)} /> Include a dream feed
        </label>
        <p className="muted hint">Build spaces that many naps and feeds evenly through
          the awake day (between the night times above); a dream feed lands about
          three hours after bedtime. Tweak the times below before saving.</p>
        <label className="f">Planned naps — start-end, comma-separated
          <input type="text" value={targetNaps} placeholder="e.g. 08:30-10:00, 11:45-13:15"
            onChange={(e) => setTargetNaps(e.target.value)} /></label>
        <label className="f">Planned feeds — times, comma-separated
          <input type="text" value={targetFeeds} placeholder="e.g. 07:00, 10:00, 13:15, 16:00"
            onChange={(e) => setTargetFeeds(e.target.value)} /></label>
        <p className="muted hint">The plan is drawn above the day summary with how the
          day compares, nap by nap and feed by feed. Night comes from the window
          above. Leave both empty for no plan.</p>
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
