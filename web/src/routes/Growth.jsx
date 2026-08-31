import { useCallback, useEffect, useState } from 'react';
import { api, localDateIso, DEMO, NeedsSignIn } from '../api.js';
import { Chrome } from '../components/Chrome.jsx';
import { useToast } from '../components/Toast.jsx';
import { GrowthChart } from '../components/charts/GrowthChart.jsx';

// Growth: weight & height against the WHO 0–24 month centile curves. The
// server computes everything (curves, centiles, labels); this view only
// renders the payload and posts new measurements.
export function Growth() {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editProfile, setEditProfile] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await api('/api/growth'));
    } catch (err) {
      // expired session: bounce to sign-in rather than a wordless blank tab
      // (the root loader doesn't revalidate on child navigations)
      if (err instanceof NeedsSignIn) return location.replace('/signin');
      setLoadError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit(path, method, body, done) {
    if (DEMO) return showToast('Demo mode — changes are not saved.', { error: true });
    if (busy) return;
    setBusy(true);
    try {
      const resp = await api(path, { method, body });
      setData(resp.growth);
      if (done) done();
    } catch (err) {
      showToast(err.message, { error: true });
    }
    setBusy(false);
  }

  if (!data) {
    return (
      <Chrome>
        {loadError && (
          <div className="card">
            <p className="status error">Growth failed to load: {loadError}</p>
            <button className="secondary" onClick={load}>Try again</button>
          </div>
        )}
      </Chrome>
    );
  }

  const needsProfile = data.needsProfile || editProfile;
  return (
    <Chrome>
      <div id="growthView">
        {needsProfile ? (
          <ProfileForm data={data} busy={busy}
            onCancel={data.needsProfile ? null : () => setEditProfile(false)}
            onSave={(body, done) => submit('/api/growth/profile', 'PUT', body,
              () => { setEditProfile(false); done(); })} />
        ) : (
          <>
            <div className="growth-profile muted">
              {data.profile.ageLabel} · {data.profile.sex} · born {data.profile.birthLabel}
              <button className="linkish" onClick={() => setEditProfile(true)}>Edit</button>
            </div>
            {data.foreignTab && (
              <p className="muted">Your sheet already has a “Growth” tab in a
                different format, so tinyloops leaves it untouched — rename or
                clear that tab to log growth here.</p>
            )}
            {data.pastStandards && (
              <p className="muted">The WHO baby charts end at 2 years, so new
                measurements no longer get a centile — the history below stays.</p>
            )}
            <ChartCard title="Weight" field="weightKg" example="4.25" step="0.01"
              chart={data.charts.weight} busy={busy}
              onAdd={(body, done) => submit('/api/growth', 'POST', body, done)} />
            <ChartCard title="Height" field="heightCm" example="58.5" step="0.1"
              chart={data.charts.length} busy={busy}
              onAdd={(body, done) => submit('/api/growth', 'POST', body, done)} />
            <Entries entries={data.entries} busy={busy}
              onDelete={(id) => submit('/api/growth/' + id, 'DELETE')} />
            <p className="muted table-note">Curves are the nine UK-WHO centile
              lines (0.4th–99.6th) of the red-book growth charts, drawn from
              the WHO Child Growth Standards for {data.profile.sex}s. (The red
              book plots the first two weeks on separate birth data, so very
              early centiles can differ slightly.) Healthy babies grow along
              very different lines — if anything worries you, ask your
              midwife, health visitor or doctor.</p>
          </>
        )}
      </div>
    </Chrome>
  );
}

function ProfileForm({ data, busy, onSave, onCancel }) {
  const [birthDate, setBirthDate] = useState(data.profile?.birthDate || '');
  const [sex, setSex] = useState(data.profile?.sex || '');
  const save = () => onSave({ birthDate, sex }, () => {});
  const ready = !busy && birthDate && sex;
  return (
    <div className="card">
      <h2>About your baby</h2>
      <p className="muted">The WHO centile curves need a birth date and sex —
        both are stored in your tracker sheet, shared with your partner.</p>
      <label className="f">Date of birth
        <input type="date" value={birthDate} max={localDateIso(0)}
          onChange={(e) => setBirthDate(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) save(); }} />
      </label>
      <div className="seg sex-seg" role="group" aria-label="Sex">
        {['girl', 'boy'].map((s) => (
          <button key={s} type="button" aria-pressed={sex === s}
            className={sex === s ? 'on' : ''}
            onClick={() => setSex(s)}>{s === 'girl' ? 'Girl' : 'Boy'}</button>
        ))}
      </div>
      <button className="primary" disabled={!ready} onClick={save}>
        {busy ? 'Saving…' : 'Show growth charts'}
      </button>
      {onCancel && (
        <button className="linkish" disabled={busy} onClick={onCancel}>Cancel</button>
      )}
    </div>
  );
}

// One measure per card: its WHO chart plus its own add row — weigh-ins and
// length measurements rarely happen on the same day, so each is logged on
// its own (the sheet row simply leaves the other column blank).
function ChartCard({ title, field, example, step, chart, busy, onAdd }) {
  const [date, setDate] = useState(() => localDateIso(0));
  const [value, setValue] = useState('');
  const add = () => onAdd({ date, [field]: value }, () => setValue(''));
  return (
    <div className="card">
      <h3>{title} ({chart.unit})</h3>
      {chart.latest && <div className="trend-note">{chart.latest.text}</div>}
      {chart.empty && (
        <div className="empty-note">No {title.toLowerCase()} logged yet — the
          curves show the UK-WHO 0.4th–99.6th centile range.</div>
      )}
      <GrowthChart chart={chart} />
      <div className="measure-form">
        <label className="f">Date
          <input type="date" value={date} max={localDateIso(0)}
            onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="f">{title} ({chart.unit})
          <input type="number" inputMode="decimal" step={step} min="0"
            placeholder={example} value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value && !busy) add(); }} />
        </label>
        <button className="primary" disabled={busy || !value} onClick={add}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function Entries({ entries, busy, onDelete }) {
  if (!entries.length) return null;
  const cell = (v) => (v ? <>{v.value} <span className="centile">{v.centile}</span></> : '–');
  return (
    <>
      <h2>Measurements</h2>
      <table className="stat-table">
        <tbody>
          <tr>
            <th>Date</th><th>Age</th><th>Weight kg</th><th>Height cm</th><th aria-label="Delete" />
          </tr>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.date}</td>
              <td>{e.age}</td>
              <td>{cell(e.weight)}</td>
              <td>{cell(e.height)}</td>
              <td>
                <button className="row-del" aria-label={`Delete measurement from ${e.date}`}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete the measurement from ${e.date}?`)) onDelete(e.id);
                  }}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
