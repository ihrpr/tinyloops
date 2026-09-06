// Shown when the Google connection died but the session cookie is still
// valid. Never navigate to /signin in that state — the router's session
// check passes and bounces straight back, a full-page redirect loop that
// hammers the API and Google's quotas (seen in production as 429s).
export function ReauthBanner() {
  return (
    <div className="warn reauth">
      <span>Google sign-in expired — entries can&apos;t load or save.</span>
      <button onClick={() => { location.href = '/auth/login'; }}>Sign back in</button>
    </div>
  );
}
