/**
 * Tinyloops Worker: serves the static PWA (via the assets binding, see
 * wrangler.toml) and implements /auth/* + /api/*.
 *
 * Design rule: the server owns ALL logic. Every GET endpoint returns
 * render-ready JSON for one view; every write re-reads the sheet and
 * returns a fresh home payload so the UI updates in a single round trip.
 * The client sends its wall-clock "now" with each request — the phone's
 * clock, not the server's, defines "today" (see time.js).
 */

import { Hono } from 'hono';
import { login, callback, logout, requireSession, accessToken, NeedsSignIn } from './auth.js';
import * as sheets from './sheets.js';
import { buildHome, buildStats, buildDay, TYPES, MAX_STATS_DAYS } from './views.js';
import { buildGrowth } from './growth.js';
import { isoToWallMs, dayStart, MS_PER_DAY } from './time.js';
import { eventParams, shareEmail, growthParams, profileParams } from './validate.js';
import { UserFacingError } from './errors.js';
import { demoEvents, demoGrowth, DEMO_SETTINGS } from './demo.js';

const app = new Hono();

// ---------- security headers on every response ----------

// Strict CSP: only same-origin scripts plus the Google Picker loader; no
// inline scripts (the app is all ES modules), no framing, connections only
// to our own origin. Blocks injected <script src>, and the exfiltration
// channels an inline handler would use, as defense-in-depth behind escaping.
// Google Picker origins are enumerated explicitly rather than wildcarded:
// it loads its bundle from apis.google.com/gstatic, lists files via XHR to
// the googleapis hosts, renders in a docs.google.com iframe, and pulls
// thumbnails from googleusercontent/gstatic. Kept as tight as the Picker
// allows; verified against the connect-existing-sheet flow.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://accounts.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com",
  "connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://docs.google.com",
  "frame-src https://docs.google.com https://accounts.google.com https://content.googleapis.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy', CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  // strict-origin-when-cross-origin (not same-origin): the Google Picker
  // validates its referrer-restricted API key via the Referer header, so
  // cross-origin requests must carry at least the origin. No paths leak.
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS only where TLS exists (never on http://localhost — a cached HSTS
  // entry there would break local dev in that browser for months)
  const host = new URL(c.req.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    c.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
});

// CSRF defense-in-depth: reject any state-changing request whose Origin
// header isn't our own. SameSite=Lax already blocks cross-site credentialed
// fetches, but this also covers form-POST vectors like /auth/logout and is
// robust if any endpoint ever accepts a simple content-type. GET/HEAD are
// safe (no state change) and the OAuth callback lands via a GET redirect.
app.use('*', async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: 'Cross-origin request rejected.' }, 403);
  }
  return next();
});

// ---------- helpers ----------

/** The client's wall-clock now. For reads a missing/invalid value falls
 *  back to server UTC (harmless — only affects "ago" text). Writes must use
 *  requireNow() instead, so a bad clock can't be stamped into the sheet. */
const nowWall = (c) => isoToWallMs(c.req.query('now')) ?? Date.now();

/** Like nowWall but rejects a missing/invalid `now`; use on write paths so
 *  server UTC is never written as the user's wall-clock time. */
function requireNow(c) {
  const now = isoToWallMs(c.req.query('now'));
  if (now == null) throw new UserFacingError('Missing or invalid time from your device.');
  return now;
}

const isDemo = (c) => c.req.query('demo') != null;

function statsRange(c, now) {
  const today = dayStart(now);
  let to = isoToWallMs(c.req.query('to')) ?? today;
  let from = isoToWallMs(c.req.query('from')) ?? to - 13 * MS_PER_DAY;
  from = dayStart(from); to = dayStart(to);
  if (from > to) return null;
  if ((to - from) / MS_PER_DAY + 1 > MAX_STATS_DAYS) return null;
  return { from, to };
}

// Callers are all behind requireSheet, so user.sheet_id is guaranteed set.
async function loadState(c) {
  return sheets.fetchState(c, c.get('user').sheet_id);
}

async function freshHome(c) {
  const state = await loadState(c);
  const home = buildHome(state.events, state.settings, nowWall(c));
  home.email = c.get('user').email;
  home.sheetUrl = sheets.sheetUrl(c.get('user').sheet_id);
  return home;
}

const noSheet = (c) => c.json({ error: 'No tracker sheet connected yet.', code: 'no_sheet' }, 409);

// ---------- auth ----------

app.get('/auth/login', login);
app.get('/auth/callback', callback);
app.post('/auth/logout', logout);

// ---------- demo (read-only, no session) ----------

app.use('/api/*', async (c, next) => {
  if (!isDemo(c)) return requireSession(c, next);
  if (c.req.method !== 'GET') {
    return c.json({ error: 'Demo mode is read-only.' }, 403);
  }
  const now = nowWall(c);
  const events = demoEvents(now);
  const path = new URL(c.req.url).pathname;
  if (path === '/api/me') {
    return c.json({ email: 'demo@example.com', hasSheet: true, demo: true });
  }
  if (path === '/api/home') {
    const home = buildHome(events, DEMO_SETTINGS, now);
    home.email = 'demo@example.com';
    home.sheetUrl = null;
    return c.json(home);
  }
  if (path === '/api/stats') {
    const r = statsRange(c, now);
    if (!r) return c.json({ error: 'Invalid date range.' }, 400);
    return c.json(buildStats(events, DEMO_SETTINGS, r.from, r.to));
  }
  if (path.startsWith('/api/days/')) {
    const date = isoToWallMs(path.slice('/api/days/'.length));
    if (date == null) return c.json({ error: 'Invalid date.' }, 400);
    return c.json(buildDay(events, date, now));
  }
  if (path === '/api/growth') {
    const g = demoGrowth(now);
    return c.json(buildGrowth(g.measurements, { ...DEMO_SETTINGS, ...g.settings }, now));
  }
  return c.json({ error: 'Not available in demo mode.' }, 404);
});

// Guard the sheet-backed routes so each handler can assume user.sheet_id.
// Registered after the session middleware (so c.var.user is set) and NOT on
// /api/me or /api/sheet* (they set/clear the sheet) or /api/picker-config.
// In demo mode the middleware above returns before reaching here.
//
// If this user joined their current sheet by accepting an invite, sheet I/O
// must run with the INVITER's Google credentials (drive.file grants are per
// account — being shared the file doesn't let the invitee's own token open
// it). Scoped to the invited sheet only: if the user later switches to a
// different sheet, the lookup misses and their own token is used again.
const requireSheet = async (c, next) => {
  const user = c.get('user');
  if (!user.sheet_id) return noSheet(c);
  const inviter = await c.env.DB.prepare(
    `SELECT u.* FROM invites i JOIN users u ON u.id = i.inviter_id
     WHERE i.accepted_by = ? AND i.sheet_id = ?
     ORDER BY i.accepted_at DESC LIMIT 1`)
    .bind(user.id, user.sheet_id).first();
  if (inviter && inviter.id !== user.id) c.set('tokenUser', inviter);
  await next();
};
app.use('/api/home', requireSheet);
app.use('/api/stats', requireSheet);
app.use('/api/days/*', requireSheet);
app.use('/api/events', requireSheet);
app.use('/api/events/*', requireSheet);
app.use('/api/settings', requireSheet);
app.use('/api/share', requireSheet);
app.use('/api/growth', requireSheet);
app.use('/api/growth/*', requireSheet);

// ---------- session info ----------

const INVITE_TTL_MS = 30 * MS_PER_DAY;

/** Newest live (unaccepted, unexpired) invite addressed to this email. */
function pendingInvite(c, email) {
  return c.env.DB.prepare(
    `SELECT i.*, u.email AS inviter_email FROM invites i
     JOIN users u ON u.id = i.inviter_id
     WHERE i.email = ? AND i.accepted_by IS NULL AND i.created_at > ?
     ORDER BY i.created_at DESC LIMIT 1`)
    .bind(email.toLowerCase(), Date.now() - INVITE_TTL_MS).first();
}

app.get('/api/me', async (c) => {
  const user = c.get('user');
  // surface a waiting invite only while there's no sheet yet — that's the
  // moment the Connect screen can offer one-tap accept
  const invite = user.sheet_id ? null : await pendingInvite(c, user.email);
  return c.json({
    email: user.email,
    hasSheet: Boolean(user.sheet_id),
    sheetUrl: user.sheet_id ? sheets.sheetUrl(user.sheet_id) : null,
    invite: invite ? { from: invite.inviter_email } : null,
  });
});

// ---------- views ----------

app.get('/api/home', async (c) => {
  return c.json(await freshHome(c));
});

app.get('/api/stats', async (c) => {
  const r = statsRange(c, nowWall(c));
  if (!r) return c.json({ error: 'Invalid date range.' }, 400);
  const state = await loadState(c);
  return c.json(buildStats(state.events, state.settings, r.from, r.to));
});

app.get('/api/days/:date', async (c) => {
  const date = isoToWallMs(c.req.param('date'));
  if (date == null) return c.json({ error: 'Invalid date.' }, 400);
  const state = await loadState(c);
  return c.json(buildDay(state.events, dayStart(date), nowWall(c)));
});

// ---------- growth (measurements + WHO centile charts) ----------

async function freshGrowth(c) {
  const state = await sheets.fetchGrowthState(c, c.get('user').sheet_id);
  const growth = buildGrowth(state.measurements, state.settings, nowWall(c));
  // a hand-made 'Growth' tab we refuse to touch — the UI explains why
  // adding measurements won't work until it's renamed or cleared
  if (state.foreignGrowth) growth.foreignTab = true;
  return growth;
}

app.get('/api/growth', async (c) => c.json(await freshGrowth(c)));

app.post('/api/growth', async (c) => {
  const user = c.get('user');
  const p = growthParams(await c.req.json(), requireNow(c));
  const id = await sheets.addMeasurement(c, user.sheet_id, p, user.email);
  return c.json({ id, growth: await freshGrowth(c) });
});

app.delete('/api/growth/:id', async (c) => {
  await sheets.deleteMeasurement(c, c.get('user').sheet_id, c.req.param('id'));
  return c.json({ growth: await freshGrowth(c) });
});

// the profile (birth date + sex) lives in the sheet's Settings tab, so both
// partners share it — it's what places measurements on the WHO age axis
app.put('/api/growth/profile', async (c) => {
  const p = profileParams(await c.req.json(), requireNow(c));
  await sheets.setSettings(c, c.get('user').sheet_id, [
    ['baby_birth_date', p.birthDate],
    ['baby_sex', p.sex],
  ]);
  return c.json({ growth: await freshGrowth(c) });
});

// ---------- writes (each returns a fresh home payload) ----------

app.post('/api/events', async (c) => {
  const user = c.get('user');
  const p = eventParams(await c.req.json());
  const id = await sheets.addEvent(c, user.sheet_id, p, user.email);
  return c.json({ id, home: await freshHome(c) });
});

app.post('/api/events/:id/stop', async (c) => {
  await sheets.stopEvent(c, c.get('user').sheet_id, c.req.param('id'), requireNow(c));
  return c.json({ home: await freshHome(c) });
});

app.patch('/api/events/:id', async (c) => {
  const p = eventParams(await c.req.json());
  p.id = c.req.param('id');
  await sheets.updateEvent(c, c.get('user').sheet_id, p);
  return c.json({ home: await freshHome(c) });
});

app.delete('/api/events/:id', async (c) => {
  await sheets.deleteEvent(c, c.get('user').sheet_id, c.req.param('id'));
  return c.json({ home: await freshHome(c) });
});

// ---------- settings (stored in the sheet's Settings tab, shared) ----------

app.put('/api/settings', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const ml = Number(body.breastfeedMl);
  if (!(ml > 0) || ml > 1000) throw new UserFacingError('Please enter a nursing amount between 1 and 1000 ml.');
  const list = (Array.isArray(body.enabledTypes) ? body.enabledTypes : [])
    .filter((k) => TYPES[k]);
  if (!list.length) throw new UserFacingError('Keep at least one activity visible.');
  await sheets.setSettings(c, user.sheet_id, [
    ['breastfeed_ml', Math.round(ml)],
    ['enabled_types', Object.keys(TYPES).filter((k) => list.includes(k)).join(',')],
  ]);
  return c.json({ home: await freshHome(c) });
});

// ---------- partner sharing ----------

app.post('/api/share', async (c) => {
  const user = c.get('user');
  const email = shareEmail((await c.req.json()).email);
  if (email.toLowerCase() === user.email.toLowerCase()) {
    throw new UserFacingError("That's your own account — enter your partner's email.");
  }
  const pending = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND accepted_by IS NULL')
    .bind(user.id).first();
  if (pending.n >= 10) {
    throw new UserFacingError('Too many open invitations — ask your partner to accept one first.');
  }

  // Best-effort Drive share so the partner's own Google account can open the
  // raw sheet too. A 400 is a bad address and fails the invite; anything
  // else (e.g. Drive API unavailable) must not block the in-app invite,
  // which works through the token proxy regardless.
  let driveShared = true;
  try {
    await sheets.shareSheet(c, user.sheet_id, email);
  } catch (err) {
    if (err.status === 400) throw err;
    driveShared = false;
  }

  // One live invite per (inviter, email): re-inviting replaces the old one.
  const now = Date.now();
  await c.env.DB.prepare(
    'DELETE FROM invites WHERE inviter_id = ? AND email = ? AND accepted_by IS NULL')
    .bind(user.id, email.toLowerCase()).run();
  await c.env.DB.prepare(
    `INSERT INTO invites (id, inviter_id, email, sheet_id, created_at)
     VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), user.id, email.toLowerCase(), user.sheet_id, now).run();
  return c.json({ ok: true, driveShared });
});

app.post('/api/invite/accept', async (c) => {
  const user = c.get('user');
  if (user.sheet_id) {
    throw new UserFacingError('This account is already connected to a tracker sheet.');
  }
  const invite = await pendingInvite(c, user.email);
  if (!invite) {
    throw new UserFacingError('No open invitation for this account — ask your partner to invite ' +
      user.email + ', or pick the shared sheet below.');
  }
  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE invites SET accepted_by = ?, accepted_at = ? WHERE id = ? AND accepted_by IS NULL')
    .bind(user.id, now, invite.id).run();
  await c.env.DB.prepare('UPDATE users SET sheet_id = ? WHERE id = ?')
    .bind(invite.sheet_id, user.id).run();
  return c.json({ ok: true });
});

// ---------- sheet connect / create / switch ----------

app.post('/api/sheet', async (c) => {
  const user = c.get('user');
  const id = await sheets.createTrackerSheet(c);
  await c.env.DB.prepare('UPDATE users SET sheet_id = ? WHERE id = ?')
    .bind(id, user.id).run();
  user.sheet_id = id;
  return c.json({ home: await freshHome(c) });
});

app.put('/api/sheet', async (c) => {
  const user = c.get('user');
  const { spreadsheetId } = await c.req.json();
  if (!/^[\w-]{20,60}$/.test(String(spreadsheetId || ''))) {
    return c.json({ error: 'Invalid spreadsheet.' }, 400);
  }
  const shape = await sheets.inspectSheet(c, spreadsheetId);
  if (shape !== 'ok') {
    return c.json({
      shape,
      error: "That spreadsheet doesn't look like a tracker sheet. " +
        'Pick the one shared with you, or create a new one instead.',
    }, 422);
  }
  await c.env.DB.prepare('UPDATE users SET sheet_id = ? WHERE id = ?')
    .bind(spreadsheetId, user.id).run();
  user.sheet_id = spreadsheetId;
  return c.json({ home: await freshHome(c) });
});

app.delete('/api/sheet', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE users SET sheet_id = NULL WHERE id = ?')
    .bind(user.id).run();
  return c.json({ ok: true });
});

// ---------- the Google Picker's short-lived credentials ----------

app.get('/api/picker-config', async (c) => {
  return c.json({
    accessToken: await accessToken(c),
    apiKey: c.env.GOOGLE_API_KEY,
    appId: c.env.GOOGLE_APP_ID,
  });
});

// ---------- static assets ----------

// Everything not matched above is a static file (HTML/JS/CSS/icons). Forward
// to the assets binding so the security-headers middleware still runs on it.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// ---------- errors ----------

app.onError((err, c) => {
  if (err instanceof NeedsSignIn) {
    return c.json({ error: 'Sign-in required' }, 401);
  }
  if (err instanceof UserFacingError) {
    return c.json({ error: err.message }, 400);
  }
  console.error(err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

export default app;
