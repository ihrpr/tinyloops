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
import { isoToWallMs, dayStart, MS_PER_DAY } from './time.js';
import { eventParams } from './validate.js';
import { UserFacingError } from './errors.js';
import { demoEvents, DEMO_SETTINGS } from './demo.js';

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
  c.header('Referrer-Policy', 'same-origin');
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
  return c.json({ error: 'Not available in demo mode.' }, 404);
});

// Guard the sheet-backed routes so each handler can assume user.sheet_id.
// Registered after the session middleware (so c.var.user is set) and NOT on
// /api/me or /api/sheet* (they set/clear the sheet) or /api/picker-config.
// In demo mode the middleware above returns before reaching here.
const requireSheet = async (c, next) => {
  if (!c.get('user').sheet_id) return noSheet(c);
  await next();
};
app.use('/api/home', requireSheet);
app.use('/api/stats', requireSheet);
app.use('/api/days/*', requireSheet);
app.use('/api/events', requireSheet);
app.use('/api/events/*', requireSheet);
app.use('/api/settings', requireSheet);

// ---------- session info ----------

app.get('/api/me', (c) => {
  const user = c.get('user');
  return c.json({
    email: user.email,
    hasSheet: Boolean(user.sheet_id),
    sheetUrl: user.sheet_id ? sheets.sheetUrl(user.sheet_id) : null,
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
