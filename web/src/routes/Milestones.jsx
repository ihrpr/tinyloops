import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, localDateIso, localNowIso, DEMO, NeedsSignIn } from '../api.js';
import { Chrome } from '../components/Chrome.jsx';
import { useToast } from '../components/Toast.jsx';
import { ReauthBanner } from '../components/ReauthBanner.jsx';
import { EditModal } from '../components/EditModal.jsx';
import { MilestoneSeg } from '../components/SideSeg.jsx';
import { IconChip } from '../components/icons.jsx';

// Milestones: the baby's firsts on an age ribbon, with the full story as a
// timeline underneath. Milestones are ordinary log entries (type
// 'milestone'), so they can be logged from the quick log too; the server
// computes every position and label — this view renders, filters and posts.
export function Milestones() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [filter, setFilter] = useState(null);   // icon key of a category, or null
  const [picked, setPicked] = useState(null);   // milestone id tapped on the ribbon
  const [editing, setEditing] = useState(null); // raw event or null
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await api('/api/milestones'));
      setNeedsReauth(false);
    } catch (err) {
      // same reconnect-in-place handling as the Growth view
      if (err instanceof NeedsSignIn) return setNeedsReauth(true);
      setLoadError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const err = (msg) => showToast(msg, { error: true });

  // every write goes through here, then the view refetches its own payload
  const run = async (fn, onError) => {
    if (DEMO) { showToast('Demo mode — changes are not saved.'); return null; }
    try {
      const resp = await fn();
      await load();
      return resp || {};
    } catch (e) {
      if (e instanceof NeedsSignIn) {
        setNeedsReauth(true);
        onError?.('Your Google session expired — sign back in above, then try again.');
      } else {
        onError?.('Could not save: ' + (e.message || e));
      }
      return null;
    }
  };

  if (!data) {
    return (
      <Chrome>
        {needsReauth && <ReauthBanner />}
        {loadError && (
          <div className="card">
            <p className="status error">Milestones failed to load: {loadError}</p>
            <button className="secondary" onClick={load}>Try again</button>
          </div>
        )}
      </Chrome>
    );
  }

  // a filter whose category just lost its last entry falls back to "all"
  const active = data.counts.some((c) => c.k === filter) ? filter : null;
  const groups = data.groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !active || it.k === active) }))
    .filter((g) => g.items.length);
  const pickedDot = data.ribbon.dots.find((d) => d.id === picked);

  function pick(id) {
    setPicked(id);
    setFilter(null); // the tapped milestone must be in the list to scroll to
    setTimeout(() => {
      document.getElementById('ms-' + id)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  return (
    <Chrome>
      {needsReauth && <ReauthBanner />}
      <div id="milestonesView">
        <div className="card ms-hero">
          <div className="ms-head">
            <IconChip k="milestone" />
            <div>
              <div className="ms-count">{data.total ? data.headline : 'Milestones'}</div>
              <div className="muted">
                {data.ageLabel || 'Every first, in one place'}
              </div>
            </div>
          </div>

          {data.total > 0 && (
            <>
              <Ribbon ribbon={data.ribbon} active={active} picked={picked} onPick={pick} />
              <div className="ms-caption">{pickedDot ? pickedDot.label : data.latest}</div>
              {data.counts.length > 1 && (
                <div className="ms-legend" role="group" aria-label="Filter by kind">
                  {data.counts.map((c) => (
                    <button key={c.k} type="button"
                      className={'ms-key' + (active === c.k ? ' on' : '')}
                      aria-pressed={active === c.k}
                      onClick={() => setFilter(active === c.k ? null : c.k)}>
                      <span className={'ms-swatch t-' + c.k} aria-hidden="true" />
                      {c.label} <b>{c.n}</b>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {data.needsBirth && (
            <p className="muted ms-hint">Add your baby’s birth date on
              the <Link to="/growth">Growth</Link> tab to see each milestone by age.</p>
          )}
        </div>

        {adding || data.total === 0 ? (
          <AddForm data={data} run={run} onError={err}
            onCancel={data.total ? () => setAdding(false) : null}
            onAdded={() => { setAdding(false); showToast('Milestone saved ✓'); }} />
        ) : (
          <button className="secondary ms-add" onClick={() => setAdding(true)}>
            + Add a milestone
          </button>
        )}

        {groups.map((g) => (
          <section key={g.label}>
            <h2>{g.label}</h2>
            <ol className="ms-list">
              {g.items.map((it) => (
                <li key={it.id} id={'ms-' + it.id}
                  className={'ms-item' + (picked === it.id ? ' picked' : '')}>
                  <IconChip k={it.k} />
                  <button type="button" className="ms-card" onClick={() => setEditing(it.raw)}>
                    <span className="ms-title">{it.title}</span>
                    <span className="ms-sub">
                      {[it.age, it.date, it.catLabel, it.by && 'by ' + it.by]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {editing && (
        <EditModal raw={editing} types={data.types} milestoneCats={data.cats} run={run}
          onError={err} onClose={() => setEditing(null)} onToast={(m) => showToast(m)} />
      )}
    </Chrome>
  );
}

// The age ribbon: birth on the left, today on the right (the server
// rescales it as the baby grows). Each milestone is a dot in its category
// colour — tap one to jump to its card.
function Ribbon({ ribbon, active, picked, onPick }) {
  const pct = (x) => `${x * 100}%`;
  return (
    <div className="ms-ribbon" style={{ '--rows': ribbon.rows }}>
      <div className="ms-track">
        <div className="ms-road" />
        {ribbon.ticks.map((t) => (
          <span key={t.x} className="ms-tick" style={{ left: pct(t.x) }}>{t.label}</span>
        ))}
        <span className="ms-now" style={{ left: pct(ribbon.nowX) }}>now</span>
        {ribbon.dots.map((d) => (
          <button key={d.id} type="button" aria-label={d.label} title={d.label}
            className={'ms-dot t-' + d.k + (picked === d.id ? ' picked' : '') +
              (active && active !== d.k ? ' dim' : '')}
            style={{ left: pct(d.x), '--row': d.row }}
            onClick={() => onPick(d.id)} />
        ))}
      </div>
    </div>
  );
}

function AddForm({ data, run, onError, onCancel, onAdded }) {
  const [text, setText] = useState('');
  const [cat, setCat] = useState('');
  const [date, setDate] = useState(() => localDateIso(0));
  const [busy, setBusy] = useState(false);

  async function save() {
    const notes = text.trim();
    if (!notes) return onError('What happened? Tap a suggestion or type it, e.g. First smile.');
    if (!date) return onError('Please pick the day it happened.');
    // today's milestone keeps the real time; a backdated one sits at midday
    const start = date === localDateIso(0) ? localNowIso() : `${date}T12:00`;
    setBusy(true);
    const resp = await run(() => api('/api/events', {
      method: 'POST', body: { type: 'milestone', start, notes, side: cat },
    }), onError);
    setBusy(false);
    if (resp) { setText(''); setCat(''); onAdded(); }
  }

  return (
    <div className="card">
      <h2>{data.total ? 'Add a milestone' : 'Log the first milestone'}</h2>
      {data.total === 0 && (
        <p className="muted">First smile, first laugh, first steps — add them here
          (backdating is fine) and they’ll line up along your baby’s first years.</p>
      )}
      {data.chips.length > 0 && (
        <div className="food-chips">
          {data.chips.map((m) => {
            const on = text.trim().toLowerCase() === m.name.toLowerCase();
            return (
              <button key={m.name} type="button" aria-pressed={on}
                className={'food-chip' + (on ? ' on' : '')}
                onClick={() => { setText(on ? '' : m.name); setCat(on ? '' : m.cat); }}>
                {m.name}
              </button>
            );
          })}
        </div>
      )}
      <label className="f">What happened
        <input type="text" value={text} maxLength={200} placeholder="e.g. First smile"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) save(); }} />
      </label>
      <label className="f">When
        <input type="date" value={date} max={localDateIso(0)}
          onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="side-hint">What kind? (optional)</div>
      <MilestoneSeg cats={data.cats} value={cat} onChange={setCat} />
      <button className="primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save milestone'}
      </button>
      {onCancel && (
        <button className="linkish" disabled={busy} onClick={onCancel}>Cancel</button>
      )}
    </div>
  );
}
