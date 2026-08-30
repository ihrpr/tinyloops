import { useEffect, useState } from 'react';
import { Mark, IconChip } from '../components/icons.jsx';

const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Line\/|GSA\/|; wv\)/.test(navigator.userAgent);

const AUTH_ERRORS = {
  state_mismatch: 'Sign-in couldn’t be verified. Please try again.',
  token_exchange: 'Google sign-in failed. Please try again.',
  token_invalid: 'Google sign-in couldn’t be verified. Please try again.',
  access_denied: 'Sign-in was cancelled.',
};

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
        <p className="tagline">Feeds, sleep and nappies — logged in seconds,
          together with your partner.</p>
      </div>

      <div className="card">
        <div className="feature">
          <IconChip k="timer" />
          <div><b>One-tap logging</b><span>Live timers for feeds, sleep and play</span></div>
        </div>
        <div className="feature">
          <IconChip k="chart" />
          <div><b>Summary &amp; stats</b><span>Milk intake, last feed, nappies at a glance</span></div>
        </div>
        <div className="feature">
          <IconChip k="lock" />
          <div><b>Yours alone</b><span>Data lives in a Google Sheet in your Drive</span></div>
        </div>
        {IN_APP_BROWSER && (
          <p className="warn">It looks like this page is open inside another app,
            where Google blocks sign-in. Open it in Safari or Chrome instead.</p>
        )}
        <button className="primary" onClick={() => { location.href = '/auth/login'; }}>
          Sign in with Google
        </button>
        {error && <p className="status error">{error}</p>}
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
    </section>
  );
}
