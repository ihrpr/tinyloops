import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mark, IconChip } from '../components/icons.jsx';

const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Line\/|GSA\/|; wv\)/.test(navigator.userAgent);

const AUTH_ERRORS = {
  state_mismatch: 'Sign-in couldn’t be verified. Please try again.',
  token_exchange: 'Google sign-in failed. Please try again.',
  token_invalid: 'Google sign-in couldn’t be verified. Please try again.',
  access_denied: 'Sign-in was cancelled.',
  drive_declined: 'tinyloops needs the “Google Drive files that you use with this app” ' +
    'permission to reach your tracker sheet. Sign in again and tick that checkbox ' +
    'on the Google screen.',
};

// Screenshots captured from demo mode (scripts note: 390×780 @2x, downscaled
// to 520px wide — see web/public/screens/).
const SCREENS = [
  { src: '/screens/log.png', caption: 'Log a feed in one tap', alt: 'The log screen: activity buttons and a running breastfeed timer' },
  { src: '/screens/stats.png', caption: 'See the day take shape', alt: 'The stats screen: daily milk and pumping charts' },
  { src: '/screens/growth.png', caption: 'Watch them grow', alt: 'The growth screen: weight and height charted over time' },
  { src: '/screens/settings.png', caption: 'Track only what you need', alt: 'The settings screen: pick which activities appear in the quick log' },
];

export function SignIn() {
  const [error, setError] = useState('');

  // Map a known ?auth_error code to a fixed message; never reflect the raw
  // value (that would put attacker text on our own origin). Then strip it.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('auth_error');
    if (code) {
      setError(AUTH_ERRORS[code] || 'Sign-in failed. Please try again.');
      history.replaceState(null, '', location.pathname);
    }
  }, []);

  return (
    <section id="view-signin">
      <div className="hero">
        <span className="brand-mark"><Mark size={54} color="#f3f1e2" /></span>
        <h1>tinyloops</h1>
        <p className="headline">The newborn weeks, without losing count</p>
        <p className="tagline">Feeds, sleep, nappies and growth — logged in one tap,
          shared with your partner, saved in a Google Sheet that’s yours.</p>
        {IN_APP_BROWSER && (
          <p className="warn">It looks like this page is open inside another app,
            where Google blocks sign-in. Open it in Safari or Chrome instead.</p>
        )}
        <button className="primary cta" onClick={() => { location.href = '/auth/login'; }}>
          Sign in with Google
        </button>
        <p className="cta-note">Free, no subscriptions</p>
        {error && <p className="status error">{error}</p>}
      </div>

      <div className="screens" role="list">
        {SCREENS.map((s) => (
          <figure className="phone" role="listitem" key={s.src}>
            <img src={s.src} alt={s.alt} width="260" height="520" loading="lazy" />
            <figcaption>{s.caption}</figcaption>
          </figure>
        ))}
      </div>

      <h2>Made for the blur of the first months</h2>
      <div className="card">
        <div className="feature">
          <IconChip k="timer" />
          <div><b>One tap, then back to the baby</b>
            <span>Live timers for feeds, sleep and play — start it and forget it</span></div>
        </div>
        <div className="feature">
          <IconChip k="feed" />
          <div><b>Built for two</b>
            <span>Invite your partner — same log on both phones, no handover mix-ups</span></div>
        </div>
        <div className="feature">
          <IconChip k="chart" />
          <div><b>Answers at 3am</b>
            <span>Which side, how long ago, how much milk today — at a glance</span></div>
        </div>
        <div className="feature">
          <IconChip k="baby" />
          <div><b>Growth at a glance</b>
            <span>Chart weight and height over time and see roughly how they’re
              tracking</span></div>
        </div>
        <div className="feature">
          <IconChip k="lock" />
          <div><b>Your data never leaves you</b>
            <span>Everything lives in a Google Sheet in your own Drive — open,
              export or delete it any time</span></div>
        </div>
      </div>

      <h2>How it works</h2>
      <div className="card">
        <ol className="steps">
          <li>Sign in with your Google account</li>
          <li>tinyloops creates one spreadsheet in your Drive — that’s the whole “database”</li>
          <li>Invite your partner and start logging</li>
        </ol>
      </div>

      <h2>Use it like an app</h2>
      <details className="card platform">
        <summary>On iPhone</summary>
        <ol className="steps">
          <li>Open this page in your <b>browser</b></li>
          <li>Tap <b>Share</b></li>
          <li>Choose <b>Add to Home Screen</b></li>
        </ol>
      </details>
      <details className="card platform">
        <summary>On Android</summary>
        <ol className="steps">
          <li>Open this page in your <b>browser</b></li>
          <li>Tap the <b>⋮</b> menu</li>
          <li>Choose <b>Add to Home screen</b></li>
        </ol>
      </details>

      <p className="legal-links">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </p>
    </section>
  );
}
