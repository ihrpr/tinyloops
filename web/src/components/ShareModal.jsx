import { useEffect, useState } from 'react';
import { api, DEMO } from '../api.js';

// Share the tracker. The primary path is a single-use invite link that works
// for anyone — a Google account attaches on opening it, and someone without
// one joins as a named caregiver (their sheet access proxies through the
// owner's credentials; see server/index.js). The modal also lists everyone
// who has joined, with remove and sign-back-in actions, and keeps the old
// email invite as a secondary path. All strings in the list arrive
// preformatted from the server.
export function ShareModal({ onClose }) {
  const [caregivers, setCaregivers] = useState(null);
  const [link, setLink] = useState('');      // freshly minted invite link
  const [linkFor, setLinkFor] = useState(''); // set when it re-links a guest
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const demoBlock = () => {
    if (DEMO) setError('Demo mode — changes are not saved.');
    return DEMO;
  };

  useEffect(() => {
    if (DEMO) { setCaregivers([]); return; }
    api('/api/caregivers')
      .then((r) => setCaregivers(r.caregivers))
      .catch((err) => setError(err.message));
  }, []);

  async function makeLink(guestId) {
    if (demoBlock()) return;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const r = await api('/api/caregivers/link', {
        method: 'POST', body: guestId ? { guestId } : {},
      });
      setLink(r.url);
      setLinkFor(guestId ? caregivers.find((x) => x.id === guestId)?.label || '' : '');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function copyLink() {
    try {
      // native share where it exists (phones) — the link usually goes
      // straight into a family chat; clipboard elsewhere
      if (navigator.share) await navigator.share({ url: link });
      else { await navigator.clipboard.writeText(link); setCopied(true); }
    } catch { /* user dismissed the share sheet */ }
  }

  async function remove(cg) {
    if (demoBlock()) return;
    if (!confirm(`Remove ${cg.label}? They lose access immediately.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/caregivers/${encodeURIComponent(cg.id)}`, { method: 'DELETE' });
      setCaregivers((prev) => prev.filter((x) => x.id !== cg.id));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function invite() {
    if (demoBlock()) return;
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
        <h2>Share your tracker</h2>
        <p className="muted hint">Partners, grandparents, nannies — everyone
          you invite sees and logs the same data. No Google account needed:
          they can join with just their name.</p>

        {link ? (
          <>
            <div className="join-link">{link}</div>
            <button className="primary" onClick={copyLink}>
              {copied ? 'Copied!' : navigator.share ? 'Share link' : 'Copy link'}
            </button>
            <p className="muted hint">{linkFor
              ? `Send it to ${linkFor} — it signs them back in on their device.
                 It works once and expires in 2 days.`
              : 'Send it to one person — it works once and expires in 2 days. ' +
                'Need to invite more people? Create another link.'}</p>
            <button className="linkish" disabled={busy} onClick={() => makeLink()}>
              Create another link
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={() => makeLink()}>
            {busy ? 'Creating…' : 'Create an invite link'}
          </button>
        )}

        {caregivers?.length > 0 && (
          <>
            <div className="modal-sub">Who has access</div>
            {caregivers.map((cg) => (
              <div className="cg-row" key={cg.id}>
                <div className="cg-who">
                  <b>{cg.label}{cg.self ? ' (you)' : ''}</b>
                  <span className="muted">{cg.sub}</span>
                </div>
                {cg.guest && (
                  <button className="linkish" disabled={busy} title="A one-tap link that signs them back in on a new device"
                    onClick={() => makeLink(cg.id)}>Sign-in link</button>
                )}
                {!cg.self && !cg.owner && (
                  <button className="linkish danger" disabled={busy}
                    onClick={() => remove(cg)}>Remove</button>
                )}
              </div>
            ))}
          </>
        )}

        <details className="email-invite">
          <summary>Invite by Google email instead</summary>
          {sent ? (
            <p className="muted hint">Invitation sent — ask <b>{email}</b> to open
              <b> tinyloops.app</b> and sign in with that Google account: they’ll
              see it and accept with one tap.</p>
          ) : (
            <>
              <p className="muted hint">Ties the invitation to their Google
                account and shares the raw spreadsheet with it too.</p>
              <label className="f">Their Google account email
                <input type="email" inputMode="email" autoComplete="email"
                  placeholder="name@gmail.com" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) invite(); }} />
              </label>
              <button className="secondary" disabled={busy} onClick={invite}>
                {busy ? 'Inviting…' : 'Invite by email'}
              </button>
            </>
          )}
        </details>

        {error && <p className="status error">{error}</p>}
        <div className="modal-actions">
          <button className="save" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
