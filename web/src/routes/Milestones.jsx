import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, localDateIso, localNowIso, DEMO, NeedsSignIn } from '../api.js';
import { Chrome } from '../components/Chrome.jsx';
import { useToast } from '../components/Toast.jsx';
import { ReauthBanner } from '../components/ReauthBanner.jsx';
import { EditModal } from '../components/EditModal.jsx';
import { IconChip } from '../components/icons.jsx';

// Milestones: the baby's firsts as a timeline, grouped by age. Milestones
// are ordinary log entries (type 'milestone'), so they can be logged from
// the quick log too; the server computes every label — this view renders
// and posts.
export function Milestones() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
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

  return (
    <Chrome>
      {needsReauth && <ReauthBanner />}
      <div id="milestonesView">
        {(data.total > 0 || data.ageLabel) && (
          <div className="ms-summary muted">
            {[data.total > 0 && data.headline, data.ageLabel].filter(Boolean).join(' · ')}
          </div>
        )}
        {data.needsBirth && (
          <p className="muted ms-hint">Add your baby’s birth date on
            the <Link to="/growth">Growth</Link> tab to see each milestone by age.</p>
        )}

        {adding || data.total === 0 ? (
          <AddForm first={data.total === 0} run={run} onError={err}
            onCancel={data.total ? () => setAdding(false) : null}
            onAdded={() => { setAdding(false); showToast('Milestone saved ✓'); }} />
        ) : (
          <button className="secondary" onClick={() => setAdding(true)}>
            + Add a milestone
          </button>
        )}

        {data.groups.map((g) => (
          <section key={g.label}>
            <h2>{g.label}</h2>
            <ol className="ms-list">
              {g.items.map((it) => (
                <li key={it.id} className="ms-item">
                  <IconChip k="milestone" />
                  <button type="button" className="ms-card" onClick={() => setEditing(it.raw)}>
                    <span className="ms-title">{it.title}</span>
                    <span className="ms-sub">
                      {[it.age, it.date, it.by && 'by ' + it.by].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {editing && (
        <EditModal raw={editing} types={data.types} run={run}
          onError={err} onClose={() => setEditing(null)} onToast={(m) => showToast(m)} />
      )}
    </Chrome>
  );
}

function AddForm({ first, run, onError, onCancel, onAdded }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(() => localDateIso(0));
  const [busy, setBusy] = useState(false);

  async function save() {
    const notes = text.trim();
    if (!notes) return onError('What happened? Describe the milestone, e.g. First smile.');
    if (!date) return onError('Please pick the day it happened.');
    // today's milestone keeps the real time; a backdated one sits at midday
    const start = date === localDateIso(0) ? localNowIso() : `${date}T12:00`;
    setBusy(true);
    const resp = await run(() => api('/api/events', {
      method: 'POST', body: { type: 'milestone', start, notes },
    }), onError);
    setBusy(false);
    if (resp) { setText(''); onAdded(); }
  }

  return (
    <div className="card">
      <h2>{first ? 'Log the first milestone' : 'Add a milestone'}</h2>
      {first && (
        <p className="muted">First smile, first laugh, first steps — add them here
          (backdating is fine) and they’ll line up by your baby’s age.</p>
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
      <button className="primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save milestone'}
      </button>
      {onCancel && (
        <button className="linkish" disabled={busy} onClick={onCancel}>Cancel</button>
      )}
    </div>
  );
}
