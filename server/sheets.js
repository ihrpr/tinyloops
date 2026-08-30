/**
 * Sheets I/O — the only code anywhere that reads or writes the spreadsheet.
 *
 * Schema — one spreadsheet, two tabs:
 *   Log:      one row per event, columns HEADERS below.
 *   Settings: key/value pairs shared by everyone using the sheet.
 *
 * All time handling goes through server/time.js (serials in, serials out —
 * never date strings). The spreadsheet is a shared, user-visible contract:
 * other clients may read and write the same tabs, so the row format must
 * never change shape.
 */

import { accessToken, NeedsSignIn } from './auth.js';
import { UserFacingError } from './errors.js';
import { cellToWallMs, wallMsToSerial } from './time.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Spreadsheet ids are validated to [\w-]{20,60} before they ever reach the
// DB, so they're already URL-safe; encoding at every interpolation is
// defense-in-depth so a future looser id can't inject path/query segments.
const enc = (id) => encodeURIComponent(id);

export const HEADERS = [
  'id', 'type', 'start_time', 'end_time', 'duration_min',
  'side', 'amount_ml', 'notes', 'logged_by', 'formula_ml',
];
export const DEFAULT_SETTINGS = {
  breastfeed_ml: 60,
  enabled_types: 'feed,bottle,sleep,play,pump,wet,dirty',
};

export const sheetUrl = (spreadsheetId) =>
  `https://docs.google.com/spreadsheets/d/${enc(spreadsheetId)}`;

/** A Google Sheets failure whose message is safe to show in the UI. */
export class SheetError extends UserFacingError {}

/**
 * Authenticated fetch against Google REST APIs using the session user's
 * access token. Retries once on 401 with a force-refreshed token.
 *
 * The transport is injectable via `c.env.__gapi` ({ token, fetch }) so the
 * write layer can be unit-tested against an in-memory Sheets double without
 * a network or a real OAuth flow; in production the hook is absent and the
 * real `accessToken`/global `fetch` are used.
 */
export async function gapiFetch(c, url, options = {}, isRetry = false) {
  const hook = c.env?.__gapi;
  const token = hook ? hook.token : await accessToken(c, { force: isRetry });
  const doFetch = hook ? hook.fetch : fetch;
  // `errors` is ours, not fetch's: an optional {status: message} map letting
  // non-Sheets calls (Drive sharing) override the Sheets-worded defaults.
  const { errors: errorMap, ...init } = options;
  const resp = await doFetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (resp.status === 401 && !isRetry) return gapiFetch(c, url, options, true);
  if (resp.status === 401) throw new NeedsSignIn();
  if (!resp.ok) {
    // Don't echo Google's raw API error text to the client (it can leak
    // internal range/quota detail). Map to fixed, user-safe messages — but
    // keep the real reason in the server log for wrangler tail debugging.
    const detail = await resp.text().catch(() => '');
    console.error('Google API', resp.status, new URL(url).pathname, detail.slice(0, 600));
    // errors carry the HTTP status so callers can tell caller-fixable
    // failures (bad email → 400) from environment ones (API disabled → 403)
    const fail = (msg) => Object.assign(new SheetError(msg), { status: resp.status });
    if (errorMap?.[resp.status]) throw fail(errorMap[resp.status]);
    if (resp.status === 403 || resp.status === 404) {
      // 404 because drive.file hides unshared files entirely
      throw fail("You don't have access to this spreadsheet. " +
        'Ask the owner to share it with you, then pick it again.');
    }
    if (resp.status === 429) {
      throw fail('Google is rate-limiting requests — please try again in a moment.');
    }
    throw fail('Google Sheets is temporarily unavailable — please try again.');
  }
  return resp.json();
}

// ---------- reads ----------

// Blank-cell contract: a blank number is `null` in memory (read side,
// numOrNull) but `''` on the sheet (write side, blankOrNum) — writing `null`
// into a values array skips the cell and leaves a stale value, so writes
// must emit `''` to actually clear a cell.
const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

function rowToEvent(row) {
  return {
    id: String(row[0] ?? ''),
    type: String(row[1] ?? ''),
    startWall: cellToWallMs(row[2]),
    endWall: cellToWallMs(row[3]),
    durationMin: numOrNull(row[4]),
    side: String(row[5] ?? ''),
    amountMl: numOrNull(row[6]),
    notes: String(row[7] ?? ''),
    loggedBy: String(row[8] ?? ''),
    formulaMl: numOrNull(row[9]),
  };
}

/**
 * Fetch the whole log and settings in one request.
 * Returns { events, settings } with events sorted newest first.
 *
 * Known ceiling: this reads the entire Log tab on every call, so latency
 * and payload grow linearly with history (~11k rows/year at newborn
 * logging rates). Fine for the first year+; if it ever hurts, read a tail
 * window for /api/home (probe the row count, fetch the last ~200 rows)
 * and keep the full read for stats only.
 */
export async function fetchState(c, spreadsheetId) {
  const ranges = ['Log!A2:J', 'Settings!A1:B']
    .map((r) => 'ranges=' + encodeURIComponent(r)).join('&');
  const res = await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
  const [logRange, settingsRange] = res.valueRanges;

  const events = (logRange.values || [])
    .map((row) => rowToEvent(row))
    .filter((e) => e.id);
  events.sort((a, b) => (b.startWall || 0) - (a.startWall || 0));

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of settingsRange.values || []) {
    if (row[0]) settings[String(row[0])] = row[1];
  }
  return { events, settings };
}

/**
 * Quick shape check for a picked spreadsheet: does it have a Log tab with
 * our header row? Returns 'ok' | 'empty' | 'foreign'.
 */
export async function inspectSheet(c, spreadsheetId) {
  const meta = await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}?fields=sheets.properties.title`);
  const titles = meta.sheets.map((s) => s.properties.title);
  if (!titles.includes('Log')) return titles.length === 1 ? 'empty' : 'foreign';
  const head = await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent('Log!A1:J1')}`);
  const row = (head.values || [])[0] || [];
  return row[0] === 'id' && row[1] === 'type' ? 'ok' : 'foreign';
}

// ---------- writes ----------

const blankOrNum = (v) => (v == null || v === '' || !isFinite(Number(v)) ? '' : Number(v));

async function logSheetId(c, spreadsheetId) {
  const meta = await gapiFetch(c, `${API}/${enc(spreadsheetId)}?fields=sheets.properties`);
  const log = meta.sheets.find((s) => s.properties.title === 'Log');
  if (!log) throw new SheetError('The Log tab is missing from this spreadsheet.');
  return log.properties.sheetId;
}

/** Scan the id column and return the 1-based row holding `id`, or throw. */
async function resolveRow(c, spreadsheetId, id) {
  const res = await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent('Log!A2:A')}`);
  const rows = res.values || [];
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || [])[0] === id) return i + 2;
  }
  throw new SheetError('Entry not found — it may have been deleted.');
}

/**
 * Confirm `id` still lives at `row`. Rows shift when another device (or a
 * human editing the sheet) inserts/deletes an entry, so between resolving a
 * row and writing to it the target can move — writing blind would corrupt or
 * delete the wrong entry. This re-reads the single cell A{row} immediately
 * before the write; the remaining race window is one round trip, and callers
 * retry once on mismatch to absorb a shift inside it.
 */
async function idAtRow(c, spreadsheetId, row) {
  const res = await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent(`Log!A${row}`)}`);
  return ((res.values || [])[0] || [])[0] ?? null;
}

/**
 * Resolve the row for `id`, run `write(row)`, but only after verifying the
 * id is still at that row. On a detected shift, re-resolve and retry once;
 * if it still mismatches, abort rather than write to the wrong row.
 *
 * This does not fully eliminate the race — the Sheets API has no
 * compare-and-swap, so a shift in the sub-second window between the verify
 * read and the write is still possible — but it shrinks the exposure from
 * the whole operation (including metadata fetches) to a single round trip,
 * and turns the common case (a shift during resolution) into a safe retry
 * instead of a wrong-row write.
 */
async function withVerifiedRow(c, spreadsheetId, id, write) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await resolveRow(c, spreadsheetId, id);
    if ((await idAtRow(c, spreadsheetId, row)) === id) {
      return write(row);
    }
    // the id moved between the scan and the verify — loop re-resolves
  }
  throw new SheetError('Entry is being edited on another device — please try again.');
}

/** Fetch a single event by id (for stop, whose duration needs the start). */
async function getEvent(c, spreadsheetId, id) {
  const row = await resolveRow(c, spreadsheetId, id);
  const res = await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent(`Log!A${row}:J${row}`)}` +
    '?valueRenderOption=UNFORMATTED_VALUE');
  const event = rowToEvent(((res.values || [])[0]) || []);
  if (event.id !== id) {
    throw new SheetError('Entry is being edited on another device — please try again.');
  }
  return { row, event };
}

/**
 * p: {type, startWall, durationMin?, side?, amountMl?, formulaMl?, notes?}
 * durationMin given → closed event. Returns the new event's id.
 */
export async function addEvent(c, spreadsheetId, p, userEmail) {
  const hasDur = Number.isFinite(p.durationMin);
  const id = crypto.randomUUID();
  const row = [
    id,
    p.type,
    wallMsToSerial(p.startWall),
    hasDur ? wallMsToSerial(p.startWall + p.durationMin * 60000) : '',
    hasDur ? p.durationMin : '',
    p.side || '',
    blankOrNum(p.amountMl),
    p.notes || '',
    userEmail || '',
    blankOrNum(p.formulaMl),
  ];
  await gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent('Log!A2:J')}:append` +
    '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { method: 'POST', body: JSON.stringify({ values: [row] }) });
  return id;
}

/** Close a running event at endWall (duration ≥ 1 minute, as before). */
export async function stopEvent(c, spreadsheetId, id, endWall) {
  // getEvent verifies the id at the row; read its start before the guarded write
  const { event } = await getEvent(c, spreadsheetId, id);
  const durationMin = event.startWall != null
    ? Math.max(1, Math.round((endWall - event.startWall) / 60000)) : 1;
  await withVerifiedRow(c, spreadsheetId, id, (row) => gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent(`Log!D${row}:E${row}`)}` +
    '?valueInputOption=RAW',
    { method: 'PUT', body: JSON.stringify({ values: [[wallMsToSerial(endWall), durationMin]] }) }));
}

/** p: {id, type, startWall, durationMin?, side?, amountMl?, formulaMl?, notes?} */
export async function updateEvent(c, spreadsheetId, p) {
  if (!Number.isFinite(p.startWall)) throw new SheetError('Please set a valid start time.');
  const hasDur = Number.isFinite(p.durationMin);
  await withVerifiedRow(c, spreadsheetId, p.id, (row) =>
    gapiFetch(c, `${API}/${enc(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          {
            range: `Log!B${row}:H${row}`,
            values: [[
              p.type,
              wallMsToSerial(p.startWall),
              hasDur ? wallMsToSerial(p.startWall + p.durationMin * 60000) : '',
              hasDur ? p.durationMin : '',
              p.side || '',
              blankOrNum(p.amountMl),
              p.notes || '',
            ]],
          },
          { range: `Log!J${row}`, values: [[blankOrNum(p.formulaMl)]] },
        ],
      }),
    }));
}

export async function deleteEvent(c, spreadsheetId, id) {
  // Fetch the grid id up front so it isn't inside the verify→delete window.
  const sheetId = await logSheetId(c, spreadsheetId);
  await withVerifiedRow(c, spreadsheetId, id, (row) =>
    gapiFetch(c, `${API}/${enc(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        }],
      }),
    }));
}

/**
 * Write several settings at once: existing keys in a single batchUpdate
 * (so partial saves can't happen between them), missing keys in one append.
 * `entries` is [[key, value], ...].
 */
export async function setSettings(c, spreadsheetId, entries) {
  const keyCol = () => gapiFetch(c,
    `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent('Settings!A1:A')}`);
  const rows = (await keyCol()).values || [];
  const rowOf = (key) => rows.findIndex((r) => (r || [])[0] === key) + 1; // 0 = missing
  const updates = entries.filter(([key]) => rowOf(key) > 0);
  const appends = entries.filter(([key]) => rowOf(key) === 0);

  if (updates.length) {
    // Verify the keys still sit at their rows before writing — same shift
    // hazard as the Log writes if another device edits Settings.
    const check = (await keyCol()).values || [];
    for (const [key] of updates) {
      if (((check[rowOf(key) - 1] || [])[0]) !== key) {
        throw new SheetError('Settings changed on another device — please try again.');
      }
    }
    await gapiFetch(c, `${API}/${enc(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: updates.map(([key, value]) => (
          { range: `Settings!B${rowOf(key)}`, values: [[value]] })),
      }),
    });
  }
  if (appends.length) {
    await gapiFetch(c,
      `${API}/${enc(spreadsheetId)}/values/${encodeURIComponent('Settings!A1:B')}:append` +
      '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: JSON.stringify({ values: appends }) });
  }
}

/**
 * Give a partner's Google account Editor access to the sheet file itself,
 * via the Drive API — allowed under drive.file for files this user already
 * granted the app (created or picked). This is about DATA ownership, not
 * app access: the tinyloops link works through the invite + token proxy
 * even without it, but the Drive share means the partner can always open,
 * export, or keep the raw sheet independently of tinyloops. Google sends
 * its own notification email. Throws with .status — the caller treats 400
 * (bad address) as fatal and anything else as best-effort.
 */
export async function shareSheet(c, spreadsheetId, email) {
  const message = "I'm tracking our baby's day with tinyloops — " +
    'sign in at tinyloops.app with this Google account to join me.';
  await gapiFetch(c,
    `https://www.googleapis.com/drive/v3/files/${enc(spreadsheetId)}/permissions` +
    `?sendNotificationEmail=true&emailMessage=${encodeURIComponent(message)}`,
    {
      method: 'POST',
      body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
      errors: {
        400: "Google didn't accept that email address — double-check it and try again.",
      },
    });
}

/** Create a fresh tracker spreadsheet in the user's Drive; returns its ID. */
export async function createTrackerSheet(c) {
  const created = await gapiFetch(c, API, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: 'Tinyloops' },
      sheets: [
        { properties: { title: 'Log', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Settings' } },
      ],
    }),
  });
  await gapiFetch(c, `${API}/${enc(created.spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: 'Log!A1', values: [HEADERS] },
        { range: 'Settings!A1', values: Object.entries(DEFAULT_SETTINGS) },
      ],
    }),
  });
  // datetime display format for the time columns (values are written as serials)
  const logId = created.sheets[0].properties.sheetId;
  await gapiFetch(c, `${API}/${enc(created.spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        repeatCell: {
          range: { sheetId: logId, startColumnIndex: 2, endColumnIndex: 4, startRowIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy hh:mm:ss' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      }],
    }),
  });
  return created.spreadsheetId;
}
