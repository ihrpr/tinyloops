import { useEffect, useState } from 'react';
import { api, localNowIso } from '../api.js';
import { SideSeg, EatenSeg } from './SideSeg.jsx';
import { IconChip } from './icons.jsx';

const numOrNull = (v) => (v.trim() === '' ? null : Number(v));

// The quick-log card: pick an activity, optionally set side/amounts/earlier,
// and log it. The type grid, labels, and side suggestion come from the server
// (home.types / home.sideHint); this only collects input and posts.
export function QuickLog({ home, run, onError, onLogged }) {
  const types = home.types.filter((t) => t.enabled);
  const [type, setType] = useState(() => {
    const cur = types.find((t) => t.key === 'feed') || types[0];
    return cur.key;
  });
  const [side, setSide] = useState('');
  const [sideTouched, setSideTouched] = useState(false);
  const [eaten, setEaten] = useState('');
  const [foods, setFoods] = useState(() => new Set());
  const [allFoods, setAllFoods] = useState(false);
  const [bottleBm, setBottleBm] = useState('');
  const [bottleF, setBottleF] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [earlier, setEarlier] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [durInput, setDurInput] = useState('');
  const [busy, setBusy] = useState(false);

  const meta = home.types.find((t) => t.key === type) || { timed: false, label: type };

  // If the current type gets disabled in settings, fall back to the first.
  useEffect(() => {
    if (!types.some((t) => t.key === type)) setType(types[0].key);
  }, [types, type]);

  // Suggest the opposite side from the last feed, until the user picks one.
  useEffect(() => {
    if (type === 'feed' && !sideTouched && !side && home.sideHint?.suggest) {
      setSide(home.sideHint.suggest);
    }
  }, [type, sideTouched, side, home.sideHint]);

  function toggleFood(name) {
    setFoods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function reset() {
    setSide(''); setSideTouched(false); setEaten('');
    setFoods(new Set()); setAllFoods(false);
    setBottleBm(''); setBottleF(''); setAmount(''); setNotes('');
    setEarlier(false); setStartInput(''); setDurInput('');
  }

  async function submit() {
    const p = { type, notes: notes.trim() };
    if (type === 'feed') p.side = side;
    if (type === 'solid') {
      p.side = eaten;
      // chips + anything typed → the same comma-separated food string
      p.notes = [...foods, notes.trim()].filter(Boolean).join(', ');
    }
    if (type === 'bottle') { p.amountMl = numOrNull(bottleBm); p.formulaMl = numOrNull(bottleF); }
    if (type === 'pump') p.amountMl = numOrNull(amount);

    if (earlier) {
      if (!startInput) return onError('Please pick when it happened.');
      p.start = startInput;
      const dur = numOrNull(durInput);
      if (meta.timed && !(dur > 0)) return onError('Please enter the duration in minutes.');
      if (dur != null) p.durationMin = dur;
    } else {
      p.start = localNowIso();
      if (meta.timed && home.open.some((e) => e.type === type) &&
          !confirm(`A ${meta.label.toLowerCase()} is already running. Start another?`)) return;
    }

    setBusy(true);
    const resp = await run(() => api('/api/events', { method: 'POST', body: p }), onError);
    setBusy(false);
    if (resp) {
      const newId = resp.id;
      reset();
      onLogged(`${meta.label} ${!earlier && meta.timed ? 'started' : 'logged'} ✓`, async () => {
        const r = await run(() => api(`/api/events/${newId}`, { method: 'DELETE' }), onError);
        if (r) onLogged('Entry removed.');
      });
    }
  }

  const goLabel = earlier ? 'Save' : (meta.timed ? 'Start ' + meta.label.toLowerCase() : 'Log now');

  return (
    <div className="card">
      <div className="type-grid">
        {types.map((t) => (
          <button
            key={t.key}
            className={'type-btn' + (t.key === type ? ' on' : '')}
            onClick={() => setType(t.key)}
          >
            <IconChip k={t.key} />
            <span>{t.short}</span>
          </button>
        ))}
      </div>

      {type === 'feed' && (
        <>
          <div className="side-hint">{home.sideHint?.text}</div>
          <SideSeg value={side} onChange={(v) => { setSide(v); setSideTouched(true); }} />
        </>
      )}

      {type === 'bottle' && (
        <div>
          <label className="f">Breast milk (ml)
            <input type="number" inputMode="numeric" min="0" value={bottleBm}
              onChange={(e) => setBottleBm(e.target.value)} /></label>
          <label className="f">Formula (ml)
            <input type="number" inputMode="numeric" min="0" value={bottleF}
              onChange={(e) => setBottleF(e.target.value)} /></label>
        </div>
      )}

      {type === 'pump' && (
        <label className="f">Amount pumped (ml)
          <input type="number" inputMode="numeric" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} /></label>
      )}

      {type === 'solid' && (
        <>
          <div className="food-chips">
            {(allFoods ? home.solidFoods : home.solidFoods.slice(0, 12))
              .map((f) => (
                <button key={f.name} type="button"
                  className={'food-chip' + (foods.has(f.name) ? ' on' : '')}
                  aria-pressed={foods.has(f.name)}
                  onClick={() => toggleFood(f.name)}>
                  <span aria-hidden="true">{f.emoji}</span> {f.name}
                </button>
              ))}
            {home.solidFoods.length > 12 && (
              <button type="button" className="food-chip more"
                onClick={() => setAllFoods(!allFoods)}>
                {allFoods ? 'less −' : 'more foods +'}
              </button>
            )}
          </div>
          <div className="side-hint">How much went down?</div>
          <EatenSeg value={eaten} onChange={setEaten} />
        </>
      )}

      <label className="toggle">
        <input type="checkbox" checked={earlier}
          onChange={(e) => {
            setEarlier(e.target.checked);
            if (e.target.checked && !startInput) setStartInput(localNowIso());
          }} /> Happened earlier
      </label>

      {earlier && (
        <div>
          <label className="f">When it started
            <input type="datetime-local" value={startInput}
              onChange={(e) => setStartInput(e.target.value)} /></label>
          {meta.timed && (
            <label className="f">Duration (minutes)
              <input type="number" inputMode="numeric" min="1" value={durInput}
                onChange={(e) => setDurInput(e.target.value)} /></label>
          )}
        </div>
      )}

      <input type="text" value={notes}
        placeholder={type === 'solid'
          ? 'Something else? e.g. mango' : 'Notes (optional)'}
        onChange={(e) => setNotes(e.target.value)} />
      <button id="goBtn" className="primary" disabled={busy} onClick={submit}>
        {busy ? 'Saving…' : goLabel}
      </button>
    </div>
  );
}
