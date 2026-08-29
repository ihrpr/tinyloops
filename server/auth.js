/**
 * Google sign-in (authorization-code flow) and cookie sessions.
 *
 * The server keeps each user's refresh token, AES-GCM-encrypted with
 * TOKEN_ENC_KEY, and silently mints short-lived access tokens from it. The
 * browser never receives the refresh token; the only Google token it ever
 * sees is a short-lived, drive.file-scoped access token handed to the Google
 * Picker for one picking session (via /api/picker-config). The session
 * cookie is httpOnly with a rolling ~90-day expiry, so signing in is a
 * once-per-device event.
 */

import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { MS_PER_DAY, MS_PER_HOUR } from './time.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const STATE_COOKIE = 'tl.state';
const PKCE_COOKIE = 'tl.pkce';
const SESSION_DAYS = 90;
const SESSION_ROLL_INTERVAL_MS = MS_PER_HOUR; // don't roll the expiry more than hourly
const STATE_MAX_AGE_S = 600;                  // OAuth state cookie lifetime
const TOKEN_EXPIRY_SKEW_S = 60;               // treat tokens as expiring this early (clock skew)

// ---------- small crypto helpers (WebCrypto, no dependencies) ----------

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decode a JWT's payload (no signature check — see callback). Returns the
 *  claims object, or null if the token is malformed. */
function decodeJwtPayload(jwt) {
  try {
    let b64u = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64u.length % 4) b64u += '='; // restore stripped base64 padding
    return JSON.parse(new TextDecoder().decode(b64dec(b64u)));
  } catch {
    return null;
  }
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** base64url(SHA-256(s)) — the S256 PKCE code challenge. */
async function sha256B64Url(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return b64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function encKey(env) {
  const raw = b64dec(env.TOKEN_ENC_KEY);
  if (raw.length !== 32) {
    // Fail loudly on a misconfigured key rather than silently running
    // AES-128 (importKey also accepts 16/24 bytes).
    throw new Error('TOKEN_ENC_KEY must be 32 bytes (base64 of `openssl rand -base64 32`)');
  }
  return crypto.subtle.importKey(
    'raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Drop stored Google tokens for a user (forces interactive sign-in). */
function clearTokens(env, userId) {
  return env.DB.prepare(
    'UPDATE users SET refresh_token_enc = NULL, access_token_enc = NULL WHERE id = ?')
    .bind(userId).run();
}

export async function encrypt(env, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await encKey(env), new TextEncoder().encode(plaintext));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), iv.length);
  return b64(out);
}

export async function decrypt(env, packed) {
  const buf = b64dec(packed);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, 12) }, await encKey(env), buf.slice(12));
  return new TextDecoder().decode(pt);
}

/** Cookies must be Secure everywhere except local dev over http://localhost;
 *  don't gate on the request protocol alone, which would ship a non-Secure
 *  cookie if TLS were ever terminated upstream and forwarded as http. */
function cookieSecure(c) {
  const url = new URL(c.req.url);
  return !(url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** Shared cookie options so the security flags can't drift between cookies. */
const cookieOpts = (c, extra) => ({
  httpOnly: true, sameSite: 'Lax', secure: cookieSecure(c), ...extra,
});

/** The __Host- prefix makes the browser itself enforce Secure + Path=/ +
 *  no Domain on the session cookie. The prefix is invalid without Secure,
 *  so plain-http localhost falls back to the bare name. */
const sessionCookieName = (c) => (cookieSecure(c) ? '__Host-tl.session' : 'tl.session');

// ---------- OAuth flow ----------

/** Always https except on localhost: a first visit over plain http (before
 *  any edge redirect kicks in) must not build an http:// redirect URI, which
 *  Google would reject as unregistered. */
const redirectUri = (c) => {
  const url = new URL(c.req.url);
  if (cookieSecure(c)) url.protocol = 'https:';
  return url.origin + '/auth/callback';
};

/** GET /auth/login[?consent=1] — send the user to Google. */
export async function login(c) {
  const state = randomToken();
  setCookie(c, STATE_COOKIE, state, cookieOpts(c, { path: '/auth', maxAge: STATE_MAX_AGE_S }));
  // PKCE (S256): binds the callback's code to this browser, on top of the
  // client secret and the state cookie (OAuth 2.1 recommends it even for
  // confidential clients).
  const verifier = randomToken();
  setCookie(c, PKCE_COOKIE, verifier, cookieOpts(c, { path: '/auth', maxAge: STATE_MAX_AGE_S }));
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    code_challenge: await sha256B64Url(verifier),
    code_challenge_method: 'S256',
  });
  // Google only reissues a refresh token when consent is shown — ask for it
  // explicitly when the callback found none stored for this user.
  if (c.req.query('consent')) q.set('prompt', 'consent');
  return c.redirect(`${AUTH_URL}?${q}`);
}

/** GET /auth/callback — exchange the code, upsert the user, set the session. */
export async function callback(c) {
  const err = c.req.query('error');
  if (err) return c.redirect(`/?auth_error=${encodeURIComponent(err)}`);

  const state = c.req.query('state');
  const cookieState = getCookie(c, STATE_COOKIE);
  const verifier = getCookie(c, PKCE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth' });
  deleteCookie(c, PKCE_COOKIE, { path: '/auth' });
  if (!state || state !== cookieState || !verifier) {
    return c.redirect('/?auth_error=state_mismatch');
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: c.req.query('code') || '',
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!resp.ok) return c.redirect('/?auth_error=token_exchange');
  const tok = await resp.json();

  // The id_token arrived directly from Google over TLS in the code flow, so
  // decoding the payload without an RS256 signature check is standard here.
  // We still validate the security-relevant claims (aud/iss/exp) before
  // trusting `sub`, so a token minted for another client can't be replayed.
  const claims = decodeJwtPayload(tok.id_token);
  const now = Date.now();
  const validIss = ['https://accounts.google.com', 'accounts.google.com'];
  if (!claims ||
      claims.aud !== c.env.GOOGLE_CLIENT_ID ||
      !validIss.includes(claims.iss) ||
      !claims.sub ||
      typeof claims.exp !== 'number' || claims.exp * 1000 < now) {
    return c.redirect('/?auth_error=token_invalid');
  }
  const userId = claims.sub;
  const email = claims.email || '';

  const existing = await c.env.DB
    .prepare('SELECT refresh_token_enc FROM users WHERE id = ?').bind(userId).first();

  if (!tok.refresh_token && !existing?.refresh_token_enc) {
    // Signed in before but we lost/never had the refresh token — one more
    // round trip with the consent screen forced.
    return c.redirect('/auth/login?consent=1');
  }

  const accessEnc = await encrypt(c.env, tok.access_token);
  const accessExp = now + (Number(tok.expires_in) - TOKEN_EXPIRY_SKEW_S) * 1000;
  if (existing) {
    const refreshEnc = tok.refresh_token
      ? await encrypt(c.env, tok.refresh_token) : existing.refresh_token_enc;
    await c.env.DB.prepare(
      `UPDATE users SET email = ?, refresh_token_enc = ?, access_token_enc = ?,
       access_token_expires = ? WHERE id = ?`)
      .bind(email, refreshEnc, accessEnc, accessExp, userId).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, refresh_token_enc, access_token_enc,
       access_token_expires, sheet_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`)
      .bind(userId, email, await encrypt(c.env, tok.refresh_token), accessEnc, accessExp, now)
      .run();
  }

  const session = randomToken();
  const expires = now + SESSION_DAYS * MS_PER_DAY;
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen, expires_at)
     VALUES (?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(session), userId, now, now, expires).run();
  setCookie(c, sessionCookieName(c), session, cookieOpts(c, { path: '/', maxAge: SESSION_DAYS * 86400 }));
  return c.redirect('/');
}

/** POST /auth/logout — drop this device's session. */
export async function logout(c) {
  const cookie = getCookie(c, sessionCookieName(c));
  if (cookie) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(await sha256Hex(cookie)).run();
  }
  deleteCookie(c, sessionCookieName(c), { path: '/' });
  return c.json({ ok: true });
}

/**
 * Session middleware for /api/*: loads the user row into c.var.user or
 * responds 401. Rolls the expiry forward at most once an hour.
 */
export async function requireSession(c, next) {
  const cookie = getCookie(c, sessionCookieName(c));
  if (!cookie) return c.json({ error: 'Sign-in required' }, 401);
  const id = await sha256Hex(cookie);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.last_seen, u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`).bind(id, now).first();
  if (!row) return c.json({ error: 'Sign-in required' }, 401);
  if (now - row.last_seen > SESSION_ROLL_INTERVAL_MS) {
    await c.env.DB.prepare(
      'UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?')
      .bind(now, now + SESSION_DAYS * MS_PER_DAY, id).run();
    // opportunistic GC of expired sessions — cheap because this branch runs
    // at most once an hour per session (no cron in a Worker)
    await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  }
  c.set('user', row);
  await next();
}

/** Thrown by the Google layer when the refresh token is dead. */
export class NeedsSignIn extends Error {
  constructor() { super('Sign-in required'); this.name = 'NeedsSignIn'; }
}

/**
 * A live access token for the user — cached in the users row, silently
 * re-minted from the refresh token when stale.
 */
export async function accessToken(c, { force = false } = {}) {
  const user = c.get('user');
  const now = Date.now();
  if (!force && user.access_token_enc && user.access_token_expires > now) {
    try {
      return await decrypt(c.env, user.access_token_enc);
    } catch {
      // unreadable cached token — fall through and mint a fresh one
    }
  }
  if (!user.refresh_token_enc) throw new NeedsSignIn();
  let refreshToken;
  try {
    refreshToken = await decrypt(c.env, user.refresh_token_enc);
  } catch {
    // ciphertext unreadable (corruption, or TOKEN_ENC_KEY rotated) — the
    // stored token is unusable, so require a fresh interactive sign-in
    // rather than surfacing an opaque 500 forever.
    await clearTokens(c.env, user.id);
    throw new NeedsSignIn();
  }
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    // Only a hard invalid_grant means the refresh token is actually dead.
    // Transient failures (429 rate limit, 500, network) must NOT wipe it —
    // Google won't reissue a refresh token without forcing consent again,
    // so destroying it on a blip would log the user out for no reason.
    // invalid_client is a server misconfig (wrong CLIENT_SECRET), not a dead
    // user token — don't wipe on it, or a bad deploy logs everyone out.
    const body = await resp.json().catch(() => ({}));
    if (body.error === 'invalid_grant') {
      await clearTokens(c.env, user.id);
      throw new NeedsSignIn();
    }
    throw new Error(`Google token refresh failed (${resp.status})`);
  }
  const tok = await resp.json();
  const expires = now + (Number(tok.expires_in) - TOKEN_EXPIRY_SKEW_S) * 1000;
  const enc = await encrypt(c.env, tok.access_token);
  await c.env.DB.prepare(
    'UPDATE users SET access_token_enc = ?, access_token_expires = ? WHERE id = ?')
    .bind(enc, expires, user.id).run();
  user.access_token_enc = enc;
  user.access_token_expires = expires;
  return tok.access_token;
}
