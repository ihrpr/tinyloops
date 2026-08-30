import { useState } from 'react';
import { api, DEMO } from '../api.js';

// Invite a partner: the server records the invitation — after signing in
// they accept it with one tap on the Connect screen, no sheet-picking. It
// also best-effort shares the sheet file with their Google account so they
// always own a direct way to the raw data.
export function ShareModal({ onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function invite() {
    if (DEMO) return setError('Demo mode — changes are not saved.');
    setBusy(true);
    setError('');
    try {
      await api('/api/share', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div id="shareOverlay" onClick={(e) => { if (e.target.id === 'shareOverlay') onClose(); }}>
      <div id="shareModal">
        {sent ? (
          <>
            <h2>Invitation sent</h2>
            <p className="muted hint">Now ask <b>{email}</b> to open
              <b> tinyloops.app</b> and sign in with that Google account —
              they&apos;ll see your invitation and accept it with one tap.
              That&apos;s it: you&apos;ll both be logging to the same tracker.</p>
            <div className="modal-actions">
              <button className="save" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h2>Invite your partner</h2>
            <p className="muted hint">You&apos;ll both see and log the same data.
              The invitation is tied to their Google account email.</p>
            <label className="f">Partner’s Google account email
              <input type="email" inputMode="email" autoComplete="email"
                placeholder="name@gmail.com" value={email} autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) invite(); }} />
            </label>
            {error && <p className="status error">{error}</p>}
            <div className="modal-actions">
              <button className="cancel" onClick={onClose}>Cancel</button>
              <button className="save" disabled={busy} onClick={invite}>
                {busy ? 'Inviting…' : 'Invite'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
