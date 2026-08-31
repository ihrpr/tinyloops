import { useState } from 'react';
import { api } from '../api.js';
import { SideSeg, EatenSeg } from './SideSeg.jsx';

const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));

// Edit or delete an existing entry. `raw` is the server-provided raw event
// (unescaped values, set into inputs via value — never innerHTML).
export function EditModal({ raw, types, run, onError, onClose, onToast }) {
  const [type, setType] = useState(raw.type);
  const [side, setSide] = useState(raw.side || '');
  const [bottleBm, setBottleBm] = useState(raw.type === 'bottle' && raw.amountMl != null ? raw.amountMl : '');
  const [bottleF, setBottleF] = useState(raw.formulaMl != null ? raw.formulaMl : '');
  const [amount, setAmount] = useState(raw.type === 'pump' && raw.amountMl != null ? raw.amountMl : '');
  const [start, setStart] = useState(raw.start || '');
  const [dur, setDur] = useState(raw.durationMin != null ? raw.durationMin : '');
  const [notes, setNotes] = useState(raw.notes || '');
  const [busy, setBusy] = useState(false);

  const meta = types.find((t) => t.key === type) || { timed: false };

  async function save() {
    if (!start) return onError('Please set a valid start time.');
    // side carries the nursing side for feeds and the eaten amount for
    // solids; the server validates each type's own vocabulary
    const keepSide = type === 'feed' || type === 'solid';
    const p = { id: raw.id, type, start, notes: notes.trim(), side: keepSide ? side : '' };
    if (meta.timed) {
      if (numOrNull(dur) != null) p.durationMin = numOrNull(dur);
    } else if (raw.type === type && raw.durationMin != null) {
      p.durationMin = raw.durationMin; // preserve legacy timed data
    }
    if (type === 'bottle') { p.amountMl = numOrNull(bottleBm); p.formulaMl = numOrNull(bottleF); }
    else if (type === 'pump') { p.amountMl = numOrNull(amount); }
    else if (raw.type === type) { p.amountMl = raw.amountMl; p.formulaMl = raw.formulaMl; }

    setBusy(true);
    const resp = await run(() => api(`/api/events/${raw.id}`, { method: 'PATCH', body: p }), onError);
    setBusy(false);
    if (resp) onClose();
  }

  async function remove() {
    if (!confirm('Delete this entry?')) return;
    setBusy(true);
    const resp = await run(() => api(`/api/events/${raw.id}`, { method: 'DELETE' }), onError);
    setBusy(false);
    if (resp) { onClose(); onToast('Entry deleted.'); }
  }

  return (
    <div id="overlay" onClick={(e) => { if (e.target.id === 'overlay') onClose(); }}>
      <div id="modal">
        <h2>Edit entry</h2>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        {type === 'feed' && <SideSeg value={side} onChange={setSide} />}
        {type === 'solid' && <EatenSeg value={side} onChange={setSide} />}

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

        <label className="f">Start
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {meta.timed && (
          <label className="f">Duration (minutes — empty = still running)
            <input type="number" inputMode="numeric" min="1" value={dur}
              onChange={(e) => setDur(e.target.value)} /></label>
        )}
        <label className="f">{type === 'solid' ? 'Food (comma-separate for the foods list)' : 'Notes'}
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        <div className="modal-actions">
          <button className="cancel" onClick={onClose}>Cancel</button>
          <button className="save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
        <button className="delete-btn" disabled={busy} onClick={remove}>Delete entry</button>
      </div>
    </div>
  );
}
