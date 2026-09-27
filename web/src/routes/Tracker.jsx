import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useHome } from '../useHome.js';
import { useDay } from '../useDay.js';
import { useToast } from '../components/Toast.jsx';
import { Chrome } from '../components/Chrome.jsx';
import { OpenTimers } from '../components/OpenTimers.jsx';
import { QuickLog } from '../components/QuickLog.jsx';
import { DaySummary } from '../components/DaySummary.jsx';
import { EntryList } from '../components/EntryList.jsx';
import { EditModal } from '../components/EditModal.jsx';
import { SettingsModal } from '../components/SettingsModal.jsx';
import { ShareModal } from '../components/ShareModal.jsx';
import { ReauthBanner } from '../components/ReauthBanner.jsx';

export function Tracker() {
  useOutletContext(); // session (kept for parity; data comes from useHome)
  const { home, status, needsReauth, load, run } = useHome();
  const dayState = useDay(home);
  const showToast = useToast();
  const [editing, setEditing] = useState(null);   // raw event or null
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const err = (msg) => showToast(msg, { error: true });
  const toast = (msg, undo) => showToast(msg, { undo });

  if (!home) {
    return (
      <Chrome>
        {needsReauth ? <ReauthBanner />
          : <p className={'status' + (status.startsWith('Failed') ? ' error' : '')}>{status}</p>}
      </Chrome>
    );
  }

  const demoBlock = () => showToast('Demo mode — changes are not saved.');

  // every write goes through here: an edit can touch any day, so drop the
  // day cache and let the selected day refetch alongside the fresh home
  const runWrite = async (fn, onError) => {
    const resp = await run(fn, onError);
    if (resp) dayState.invalidate();
    return resp;
  };

  const stop = (id) => DEMO ? demoBlock()
    : runWrite(() => api(`/api/events/${id}/stop`, { method: 'POST', body: {} }), err);

  async function signOut() {
    if (!DEMO) { try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out anyway */ } }
    location.href = '/signin';
  }
  async function switchSheet() {
    if (DEMO) return demoBlock();
    try { await api('/api/sheet', { method: 'DELETE' }); location.href = '/connect'; }
    catch (e) { err(e.message); }
  }

  const wrappedRun = DEMO ? (() => { demoBlock(); return Promise.resolve(null); }) : runWrite;

  return (
    <Chrome topDate={home.topDate} sheetUrl={home.sheetUrl} onSettings={() => setSettingsOpen(true)}>
      {needsReauth && <ReauthBanner />}

      <div id="logView">
        <div className="col-a">
          <OpenTimers open={home.open} onEdit={setEditing} onStop={stop} />
          <QuickLog home={home} run={wrappedRun} onError={err} onLogged={toast} />
          <h2>Day summary</h2>
          <DaySummary summary={home.summary} day={dayState.day} nav={dayState}
            onEditNursing={() => setSettingsOpen(true)} />
        </div>
        <div className="col-b">
          {/* the list follows the day picked in the summary (default today) */}
          <h2>{dayState.day ? dayState.day.name : 'Today'}</h2>
          <EntryList day={dayState.day} onEdit={setEditing} />
        </div>
      </div>

      <div className="footer-actions">
        <button className="linkish"
          onClick={() => { dayState.invalidate(); load(); }}>Refresh</button>
        {/* guests joined someone else's sheet: sharing and sheet management
            belong to the Google-signed-in family members */}
        {!home.guest && (
          <>
            <button className="linkish" onClick={() => setShareOpen(true)}>Invite caregiver</button>
            <button className="linkish" onClick={switchSheet}>Switch sheet</button>
          </>
        )}
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
