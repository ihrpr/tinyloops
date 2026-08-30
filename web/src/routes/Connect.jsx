import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { pickSpreadsheet } from '../picker.js';
import { Mark } from '../components/icons.jsx';

export function Connect() {
  const session = useOutletContext();
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(null); // 'create' | 'pick' | null

  const say = (msg, isError = false) => { setStatus(msg); setError(isError); };

  // Wrong account? This is the only screen between sign-in and the tracker,
  // so it needs its own way back out.
  async function signOut() {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out anyway */ }
    location.href = '/signin';
  }

  // On success we do a full navigation, not a client-side navigate(): the
  // root loader cached hasSheet:false at page load, and a soft navigation
  // would not re-run it — the shell would bounce straight back here.
  async function createSheet() {
    setBusy('create');
    try {
      say('Creating your tracker sheet — this takes a few seconds…');
      await api('/api/sheet', { method: 'POST' });
      say('Done! Opening your tracker…');
      location.replace('/');
    } catch (err) {
      say('Could not create the sheet: ' + err.message, true);
      setBusy(null);
    }
  }

  async function pickSheet() {
    setBusy('pick');
    try {
      const picked = await pickSpreadsheet();
      if (!picked) { setBusy(null); say(''); return; }
      say('Checking the sheet…');
      await api('/api/sheet', { method: 'PUT', body: { spreadsheetId: picked } });
      say('Done! Opening your tracker…');
      location.replace('/');
    } catch (err) {
      say(err.message, true);
      setBusy(null);
    }
  }

  async function acceptInvite() {
    setBusy('accept');
    try {
      say('Connecting you to the shared tracker…');
      await api('/api/invite/accept', { method: 'POST', body: {} });
      say('Done! Opening your tracker…');
      location.replace('/');
    } catch (err) {
      say(err.message, true);
      setBusy(null);
    }
  }

  return (
    <section id="view-connect">
      <div className="brand" style={{ marginBottom: 14 }}>
        <span className="brand-mark"><Mark size={28} color="#f3f1e2" /></span>
        <h1 style={{ marginBottom: 0 }}>tinyloops</h1>
      </div>
      {session?.invite && (
        <div className="card invite-card">
          <h2>You’re invited</h2>
          <p><b>{session.invite.from}</b> invited you to track your baby’s
            day together.</p>
          <button className="primary" disabled={busy !== null} onClick={acceptInvite}>
            {busy === 'accept' ? 'Connecting…' : 'Accept invitation'}
          </button>
          <p className="muted">You’ll share one tracker — every feed, nap and
            nappy shows up for both of you.</p>
        </div>
      )}
      <div className="card">
        <h2>{session?.invite ? 'Or set up your own' : 'Set up your tracker'}</h2>
        <p>Your data lives in a Google Sheet. Create a new one, or open one
          that was shared with you.</p>
        <button className="primary" disabled={busy !== null} onClick={createSheet}>
          {busy === 'create' ? 'Creating your sheet…' : 'Create a new tracker sheet'}
        </button>
        <p className="muted">We&apos;ll create an empty spreadsheet called “Tinyloops”
          in your Google Drive. You can open, export or delete it at any time.</p>
        <button className="secondary" disabled={busy !== null} onClick={pickSheet}>
          {busy === 'pick' ? 'Connecting…' : 'Open an existing tracker sheet'}
        </button>
        <p className="muted">Already have a tracker sheet in your Google Drive —
          from before, or shared with you directly? Pick it here to connect it.</p>
      </div>
      <div className="card">
        <h2>Tracking together?</h2>
        <p className="muted">One of you creates the sheet, then invites the other
          with “Invite partner” inside the tracker — the invitation appears right
          here, on this screen, once they sign in with the invited email.
          {session?.invite ? '' : ' Expecting one but not seeing it? Check you’re ' +
          'signed in with the address your partner invited.'}</p>
      </div>
      {status && <p className={'status' + (error ? ' error' : '')}>{status}</p>}
      <div className="footer-actions">
        {session?.email && <span className="muted">Signed in as {session.email}</span>}
        <button className="linkish" onClick={signOut}>Sign out</button>
      </div>
      <p className="legal-links">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </p>
    </section>
  );
}
