import { Link } from 'react-router-dom';
import { Mark } from '../components/icons.jsx';

// Public legal pages (linked from the Google OAuth consent screen). They
// live outside the App shell on purpose: no session lookup, no redirects —
// they must load for anyone, signed in or not.
function LegalPage({ title, updated, children }) {
  return (
    <main className="wrap legal">
      <div className="brand" style={{ marginBottom: 4 }}>
        <span className="brand-mark"><Mark size={28} color="#f3f1e2" /></span>
        <h1 style={{ marginBottom: 0 }}>tinyloops</h1>
      </div>
      <h1 style={{ marginTop: 18 }}>{title}</h1>
      <p className="muted">Last updated {updated}</p>
      {children}
      <p style={{ marginTop: 28 }}><Link to="/">← Back to tinyloops</Link></p>
    </main>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="30 August 2026">
      <p>tinyloops is a small baby-tracking app. The short version: your
      tracking data lives in a Google Sheet in <b>your own</b> Google Drive,
      we store the minimum needed to sign you in, and we don&apos;t run
      analytics, show ads, or share anything with anyone.</p>

      <h2>Your tracking data: stored by you, not by us</h2>
      <p>Feeds, sleep, nappies and notes live in a single Google Sheet in
      your Google Drive. We never keep a copy: each time you open the app,
      the server reads your sheet, computes the screen, sends it back to
      you, and retains nothing.</p>

      <h2>The only thing we store</h2>
      <p>One small account record: your Google account email address, the
      ID of the spreadsheet you connected, and an encrypted sign-in
      credential (an OAuth refresh token, encrypted at rest) that lets the
      app read and write that spreadsheet on your behalf. This lives on
      Cloudflare&apos;s infrastructure, where the app is hosted.</p>

      <h2>What we can access</h2>
      <p>The app uses Google&apos;s <code>drive.file</code> permission, which
      only grants access to files you create with the app or explicitly pick
      in its file picker — it cannot see the rest of your Drive.</p>

      <h2>Cookies</h2>
      <p>One essential session cookie keeps you signed in (up to 90 days),
      plus two short-lived cookies that exist only during the sign-in
      handshake. There are no analytics or tracking cookies.</p>

      <h2>What we don&apos;t do</h2>
      <p>No analytics, no advertising, no selling or sharing of data, no
      third-party services beyond Google (sign-in, Sheets, Drive) and
      Cloudflare (hosting — which, like most hosts, keeps short-lived
      operational request logs).</p>

      <h2>Your controls</h2>
      <p>Sign out at any time from the app. Revoke the app&apos;s access
      entirely at <a href="https://myaccount.google.com/permissions"
      target="_blank" rel="noopener">myaccount.google.com/permissions</a>.
      Your sheet is an ordinary spreadsheet you can export, move, or delete
      whenever you like. To have your account record deleted from our
      systems, email us and we&apos;ll remove it.</p>

      <h2>Contact</h2>
      <p><a href="mailto:hello@tinyloops.app">hello@tinyloops.app</a></p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of service" updated="30 August 2026">
      <p>tinyloops is a free, personal project. By using it you agree to
      these (deliberately short) terms.</p>

      <h2>Not medical advice</h2>
      <p>tinyloops is a record-keeping tool. Nothing it shows — totals,
      trends, summaries — is medical advice. For any concern about your
      baby&apos;s feeding, sleep, or health, talk to a qualified health
      professional.</p>

      <h2>Your data is yours</h2>
      <p>Your tracking data lives in a Google Sheet in your own Google
      Drive and belongs to you. Deleting the sheet, or revoking the
      app&apos;s access, is always in your hands. See the
      {' '}<Link to="/privacy">privacy policy</Link> for details.</p>

      <h2>The service is provided as-is</h2>
      <p>We aim to keep tinyloops working well, but it comes with no
      warranty and no uptime guarantee. It may change or be discontinued;
      because your data is in your own sheet, it remains readable even if
      the app goes away.</p>

      <h2>Fair use</h2>
      <p>Don&apos;t abuse the service (automated scraping, attempts to
      access other people&apos;s data, or disrupting its operation). We may
      suspend access that does.</p>

      <h2>Contact</h2>
      <p><a href="mailto:hello@tinyloops.app">hello@tinyloops.app</a></p>
    </LegalPage>
  );
}
