import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useHome } from '../useHome.js';
import { useToast } from '../components/Toast.jsx';
import { Chrome } from '../components/Chrome.jsx';
import { OpenTimers } from '../components/OpenTimers.jsx';
import { QuickLog } from '../components/QuickLog.jsx';
import { DaySummary } from '../components/DaySummary.jsx';
import { EntryList } from '../components/EntryList.jsx';
import { EditModal } from '../components/EditModal.jsx';
import { SettingsModal } from '../components/SettingsModal.jsx';
import { ShareModal } from '../components/ShareModal.jsx';

export function Tracker() {
  useOutletContext(); // session (kept for parity; data comes from useHome)
  const { home, status, needsReauth, load, run } = useHome();
  const showToast = useToast();
  const [editing, setEditing] = useState(null);   // raw event or null
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const err = (msg) => showToast(msg, { error: true });
  const toast = (msg, undo) => showToast(msg, { undo });

  if (!home) {
    return (
      <Chrome>
        <p className={'status' + (status.startsWith('Failed') ? ' error' : '')}>{status}</p>
      </Chrome>
    );
  }

  const demoBlock = () => showToast('Demo mode — changes are not saved.');

  const stop = (id) => DEMO ? demoBlock()
    : run(() => api(`/api/events/${id}/stop`, { method: 'POST', body: {} }), err);

  async function signOut() {
    if (!DEMO) { try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out anyway */ } }
    location.href = '/signin';
  }
  async function switchSheet() {
    if (DEMO) return demoBlock();
    try { await api('/api/sheet', { method: 'DELETE' }); location.href = '/connect'; }
    catch (e) { err(e.message); }
  }

  const wrappedRun = DEMO ? (() => { demoBlock(); return Promise.resolve(null); }) : run;

  return (
    <Chrome topDate={home.topDate} sheetUrl={home.sheetUrl} onSettings={() => setSettingsOpen(true)}>
      {needsReauth && (
        <div className="warn reauth">
          <span>Google sign-in expired — new entries can&apos;t load or save.</span>
          <button onClick={() => { location.href = '/auth/login'; }}>Sign back in</button>
        </div>
      )}

      <div id="logView">
        <div className="col-a">
          <OpenTimers open={home.open} onEdit={setEditing} onStop={stop} />
          <QuickLog home={home} run={wrappedRun} onError={err} onLogged={toast} />
          <h2>Day summary</h2>
          <DaySummary summary={home.summary} onEditNursing={() => setSettingsOpen(true)} />
        </div>
        <div className="col-b">
          <h2>Today &amp; yesterday</h2>
          <EntryList list={home.list} onEdit={setEditing} />
        </div>
      </div>

      <div className="footer-actions">
        <button className="linkish" onClick={load}>Refresh</button>
        <button className="linkish" onClick={() => setShareOpen(true)}>Invite partner</button>
        <button className="linkish" onClick={switchSheet}>Switch sheet</button>
        <button className="linkish" onClick={signOut}>Sign out</button>
      </div>
      <p className="legal-links">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </p>

      {editing && (
        <EditModal raw={editing} types={home.types} run={wrappedRun}
          onError={err} onClose={() => setEditing(null)} onToast={(m) => showToast(m)} />
      )}
      {settingsOpen && (
        <SettingsModal home={home} run={wrappedRun}
          onError={err} onClose={() => setSettingsOpen(false)} />
      )}
      {shareOpen && <ShareModal onClose={() => setShareOpen(false)} />}
    </Chrome>
  );
}
