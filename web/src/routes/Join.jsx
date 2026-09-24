import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { passkeySupported, registerPasskey, passkeyCancelled } from '../passkeys.js';
import { Mark } from '../components/icons.jsx';

// The caregiver join page (/join/<code>) — reached from an invite link, so
// it must work with no session and no Google account. The server decides
// what the link allows; this renders the three cases: join with just a
// name, attach a signed-in Google account, or sign an existing caregiver
// back in (a re-link).
export function Join() {
  const { code } = useParams();
  const [link, setLink] = useState(null);   // GET /api/join/:code payload
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false); // joined — offering a passkey

  useEffect(() => {
    api(`/api/join/${code}`)
      .then(setLink)
      .catch((err) => setError(err.message));
  }, [code]);

  async function join(body) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/join/${code}`, { method: 'POST', body });
      // Guests get one more step: offer a passkey, so this person can sign
      // back in by themselves (the home-screen app has its own cookie jar —
      // without one, getting back in means asking for a new link). Google
      // users skip it: they can always sign in with Google.
      if (!link.signedIn && passkeySupported()) {
        setJoined(true);
        setBusy(false);
        return;
      }
      // full navigation: the root loader must re-run with the new session
      location.replace('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    setError('');
    try {
      await registerPasskey();
      location.replace('/');
    } catch (err) {
      if (!passkeyCancelled(err)) setError(err.message); // dismissing the OS sheet is not an error
      setBusy(false);
    }
  }

  const signedIn = link?.signedIn;
  const canAttach = signedIn && !signedIn.guest && !signedIn.hasSheet;

  return (
    <main className="wrap" id="view-join">
      <div className="brand" style={{ marginBottom: 14 }}>
        <span className="brand-mark"><Mark size={28} color="#f3f1e2" /></span>
        <h1 style={{ marginBottom: 0 }}>tinyloops</h1>
      </div>

      {!link && !error && <p className="status">Checking your invitation…</p>}

      {link && joined && (
        <div className="card invite-card">
          <h2>You’re in!</h2>
          <p>One more thing: add <b>Face ID or fingerprint sign-in</b>, so this
            device can always get back into the tracker — even from the
            home-screen app, with no new link needed.</p>
          <button className="primary" disabled={busy} onClick={addPasskey}>
            {busy ? 'Waiting for your device…' : 'Add Face ID / fingerprint'}
          </button>
          <button className="secondary" disabled={busy}
            onClick={() => location.replace('/')}>Not now</button>
          <p className="muted hint">Skipping is fine — if you get signed out
            later, ask for a fresh sign-in link.</p>
        </div>
      )}

      {link && !joined && (
        <div className="card invite-card">
          <h2>{link.relink ? 'Welcome back' : 'You’re invited'}</h2>
          <p><b>{link.from}</b> invited you to help track their baby’s day —
            feeds, naps and everything in between.</p>

          {link.relink ? (
            <button className="primary" disabled={busy} onClick={() => join({})}>
              {busy ? 'Signing you in…' : 'Sign back in'}
            </button>
          ) : canAttach ? (
            <>
              <p className="muted">You’re signed in as <b>{signedIn.email}</b>.</p>
              <button className="primary" disabled={busy} onClick={() => join({})}>
                {busy ? 'Joining…' : `Join as ${signedIn.email}`}
              </button>
            </>
          ) : signedIn ? (
            <p className="muted">This device is already signed in
              {signedIn.guest ? ' as a caregiver' : ` as ${signedIn.email}, which has its own tracker`}.
              Open the link on the new caregiver’s device instead,
              or <a href="/">go to your tracker</a>.</p>
          ) : (
            <>
              <label className="f">Your name
                <input type="text" autoComplete="name" placeholder="e.g. Granny Vera"
                  value={name} autoFocus maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) join({ name }); }} />
              </label>
              <p className="muted hint">Shown next to what you log, so everyone
                knows who fed the baby. No account or password needed.</p>
              <button className="primary" disabled={busy} onClick={() => join({ name })}>
                {busy ? 'Joining…' : 'Join the tracker'}
              </button>
              <p className="muted or-divider">or</p>
              <button className="secondary" disabled={busy}
                onClick={() => { location.href = `/auth/login?next=${encodeURIComponent(`/join/${code}`)}`; }}>
                Sign in with Google instead
              </button>
              <p className="muted hint">With a Google account you can also open
                the raw spreadsheet the data lives in.</p>
            </>
          )}
        </div>
      )}

      {error && <p className="status error">{error}</p>}
      <p className="legal-links">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </p>
    </main>
  );
}
