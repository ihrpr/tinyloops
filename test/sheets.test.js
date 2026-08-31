import { describe, it, expect } from 'vitest';
import { FakeSheets, makeCtx } from './fake-sheets.js';
import {
  addEvent, stopEvent, updateEvent, deleteEvent, setSettings,
  fetchState, gapiFetch, shareSheet,
  addMeasurement, deleteMeasurement, fetchGrowthState, createTrackerSheet,
} from '../server/sheets.js';
import { NeedsSignIn } from '../server/auth.js';
import { isoToWallMs, cellToWallMs } from '../server/time.js';

const wall = (iso) => isoToWallMs(iso);

// three events, ids A/B/C on rows 2/3/4
function threeEvents() {
  return [
    ['A', 'feed', serial('2026-08-29T09:00'), serial('2026-08-29T09:20'), 20, 'L', '', '', 'p@x', ''],
    ['B', 'feed', serial('2026-08-29T12:00'), serial('2026-08-29T12:20'), 20, 'R', '', '', 'p@x', ''],
    ['C', 'bottle', serial('2026-08-29T15:00'), '', '', '', 80, '', 'p@x', 40],
  ];
}
// serial helper mirroring time.js (avoid importing to keep the fixture explicit)
function serial(iso) {
  return (isoToWallMs(iso) - Date.UTC(1899, 11, 30)) / 86400000;
}

describe('addEvent', () => {
  it('appends a row with times as serial numbers, not strings', async () => {
    const fake = new FakeSheets('s');
    const ctx = makeCtx(fake);
    const id = await addEvent(ctx, 's', { type: 'feed', startWall: wall('2026-08-29T14:02'), side: 'L' }, 'me@x');
    const row = fake.logRows()[0];
    expect(row[0]).toBe(id);
    expect(typeof row[2]).toBe('number');              // start_time is a serial
    expect(cellToWallMs(row[2])).toBe(wall('2026-08-29T14:02'));
    expect(row[3]).toBe('');                            // open event → blank end
    expect(row[8]).toBe('me@x');
  });

  it('writes both end_time (serial) and duration for a closed event', async () => {
    const fake = new FakeSheets('s');
    const ctx = makeCtx(fake);
    await addEvent(ctx, 's', { type: 'sleep', startWall: wall('2026-08-29T10:00'), durationMin: 90 }, 'me@x');
    const row = fake.logRows()[0];
    expect(typeof row[3]).toBe('number');
    expect(cellToWallMs(row[3])).toBe(wall('2026-08-29T11:30'));
    expect(row[4]).toBe(90);
  });
});

describe('deleteEvent — deletes the row holding the id, never a neighbor', () => {
  it('deletes the middle event, leaving the others intact', async () => {
    const fake = new FakeSheets('s', { log: threeEvents() });
    await deleteEvent(makeCtx(fake), 's', 'B');
    const ids = fake.logRows().map((r) => r[0]);
    expect(ids).toEqual(['A', 'C']);
  });

  it('deletes the correct id even after rows shifted since the last read', async () => {
    // Simulate a concurrent delete: after resolveRow sees B at row 3, an
    // earlier row is removed so B moves to row 2. withVerifiedRow's re-check
    // must catch the shift and still delete B, not its old neighbor.
    const fake = new FakeSheets('s', { log: threeEvents() });
    let firstScan = true;
    const realFetch = fake.fetch;
    fake.fetch = async (url, opts) => {
      const u = new URL(url);
      // after the very first id-column scan, drop row 2 (A) to shift B up
      const res = await realFetch(url, opts);
      if (firstScan && decodeURIComponent(u.pathname).includes('/values/Log!A2:A')) {
        firstScan = false;
        fake.tabs.Log.splice(1, 1); // remove A (data row index 0)
      }
      return res;
    };
    await deleteEvent(makeCtx(fake), 's', 'B');
    const ids = fake.logRows().map((r) => r[0]);
    expect(ids).toContain('C');
    expect(ids).not.toContain('B'); // B was correctly deleted
  });
});

describe('updateEvent — writes to the verified row only', () => {
  it('updates B without touching A or C', async () => {
    const fake = new FakeSheets('s', { log: threeEvents() });
    await updateEvent(makeCtx(fake), 's', {
      id: 'B', type: 'feed', startWall: wall('2026-08-29T12:30'),
      durationMin: 25, side: 'both', notes: 'fussy',
    });
    const rows = fake.logRows();
    const b = rows.find((r) => r[0] === 'B');
    expect(b[5]).toBe('both');
    expect(b[7]).toBe('fussy');
    expect(cellToWallMs(b[2])).toBe(wall('2026-08-29T12:30'));
    expect(typeof b[2]).toBe('number'); // still a serial, never a string
    // neighbors untouched
    expect(rows.find((r) => r[0] === 'A')[5]).toBe('L');
    expect(rows.find((r) => r[0] === 'C')[6]).toBe(80);
  });

  it('aborts (throws) rather than write when the id keeps moving', async () => {
    const fake = new FakeSheets('s', { log: threeEvents() });
    const realFetch = fake.fetch;
    // Every id-column scan is followed by a shift, so the verify never matches.
    fake.fetch = async (url, opts) => {
      const u = new URL(url);
      const res = await realFetch(url, opts);
      if (decodeURIComponent(u.pathname).includes('/values/Log!A2:A')) {
        fake.tabs.Log.push(['Z', 'wet', serial('2026-08-29T01:00'), '', '', '', '', '', 'p@x', '']);
        fake.tabs.Log.splice(1, 0, fake.tabs.Log.pop()); // insert at top → shift everything
      }
      return res;
    };
    await expect(updateEvent(makeCtx(fake), 's', {
      id: 'B', type: 'feed', startWall: wall('2026-08-29T12:30'),
    })).rejects.toThrow(/another device/);
  });
});

describe('stopEvent', () => {
  it('writes a serial end_time and a duration ≥ 1', async () => {
    const open = [['O', 'sleep', serial('2026-08-29T10:00'), '', '', '', '', '', 'p@x', '']];
    const fake = new FakeSheets('s', { log: open });
    await stopEvent(makeCtx(fake), 's', 'O', wall('2026-08-29T11:00'));
    const row = fake.logRows()[0];
    expect(typeof row[3]).toBe('number');
    expect(cellToWallMs(row[3])).toBe(wall('2026-08-29T11:00'));
    expect(row[4]).toBe(60);
  });
});

describe('setSettings', () => {
  it('updates existing keys in place and appends new ones', async () => {
    const fake = new FakeSheets('s', { settings: [['breastfeed_ml', 60]] });
    await setSettings(makeCtx(fake), 's', [
      ['breastfeed_ml', 75],
      ['enabled_types', 'feed,wet'],
    ]);
    expect(fake.tabs.Settings[0]).toEqual(['breastfeed_ml', 75]);
    expect(fake.tabs.Settings).toContainEqual(['enabled_types', 'feed,wet']);
  });
  it('writes all existing keys in one batchUpdate (no partial saves)', async () => {
    const fake = new FakeSheets('s', {
      settings: [['breastfeed_ml', 60], ['enabled_types', 'feed']],
    });
    await setSettings(makeCtx(fake), 's', [
      ['breastfeed_ml', 80],
      ['enabled_types', 'feed,sleep'],
    ]);
    const writes = fake.requests.filter((r) => r.op === 'valuesBatchUpdate');
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toHaveLength(2);
    expect(fake.tabs.Settings).toEqual([['breastfeed_ml', 80], ['enabled_types', 'feed,sleep']]);
  });
  it('aborts without writing when a key row shifted underneath', async () => {
    const fake = new FakeSheets('s', { settings: [['breastfeed_ml', 60]] });
    let reads = 0;
    const realFetch = fake.fetch;
    fake.fetch = async (url, opts) => {
      const res = await realFetch(url, opts);
      const path = decodeURIComponent(new URL(url).pathname);
      // after the first key-column scan, insert a row above the key
      if (path.includes('/values/Settings!A1:A') && ++reads === 1) {
        fake.tabs.Settings.unshift(['other_key', 'x']);
      }
      return res;
    };
    await expect(setSettings(makeCtx(fake), 's', [['breastfeed_ml', 75]]))
      .rejects.toThrow(/another device/);
    expect(fake.tabs.Settings).toContainEqual(['breastfeed_ml', 60]); // unchanged
  });
});

describe('fetchState', () => {
  it('reads rows into events (newest first) with serials decoded to wall ms', async () => {
    const fake = new FakeSheets('s', { log: threeEvents() });
    const { events } = await fetchState(makeCtx(fake), 's');
    expect(events.map((e) => e.id)).toEqual(['C', 'B', 'A']); // newest first
    expect(events[2].startWall).toBe(wall('2026-08-29T09:00'));
  });
});

describe('gapiFetch — error mapping', () => {
  const ctxWith = (status) => makeCtx(async () =>
    new Response(JSON.stringify({ error: { message: 'internal detail' } }), { status }));

  it('403/404 → generic access message, never Google raw text', async () => {
    await expect(gapiFetch(ctxWith(404), 'https://x/y')).rejects.toThrow(/access to this spreadsheet/);
    await expect(gapiFetch(ctxWith(403), 'https://x/y')).rejects.not.toThrow(/internal detail/);
  });
  it('429 → rate-limit message', async () => {
    await expect(gapiFetch(ctxWith(429), 'https://x/y')).rejects.toThrow(/rate-limiting/);
  });
  it('500 → temporarily-unavailable message', async () => {
    await expect(gapiFetch(ctxWith(500), 'https://x/y')).rejects.toThrow(/temporarily unavailable/);
  });
  it('401 without a retry hook → NeedsSignIn', async () => {
    // hook token is static, so the forced-retry also 401s → NeedsSignIn
    let calls = 0;
    const ctx = makeCtx(async () => { calls++; return new Response('', { status: 401 }); });
    await expect(gapiFetch(ctx, 'https://x/y')).rejects.toBeInstanceOf(NeedsSignIn);
    expect(calls).toBe(2); // original + one retry
  });
});

describe('growth measurements', () => {
  const M = { dateWall: wall('2026-08-01T00:00'), weightKg: 5.42, heightCm: 58.5, notes: '' };

  it('creates the Growth tab (header + date format) on first write', async () => {
    const fake = new FakeSheets('s'); // a sheet from before growth tracking
    const id = await addMeasurement(makeCtx(fake), 's', M, 'me@x');
    expect(fake.tabs.Growth[0]).toEqual(['id', 'date', 'weight_kg', 'height_cm', 'notes', 'logged_by']);
    const row = fake.growthRows()[0];
    expect(row[0]).toBe(id);
    expect(typeof row[1]).toBe('number'); // date is a serial, never a string
    expect(cellToWallMs(row[1])).toBe(wall('2026-08-01T00:00'));
    expect(row[2]).toBe(5.42);
    expect(row[5]).toBe('me@x');
    // the new tab's date column got a display format
    const fmt = fake.requests.find((r) => r.op === 'batchUpdate' &&
      r.requests.some((q) => q.repeatCell));
    expect(fmt.requests[0].repeatCell.range.sheetId).toBe(333);
  });

  it('appends without touching an existing Growth tab', async () => {
    const fake = new FakeSheets('s', { growth: [['G1', 46000, 4.1, '', '', 'p@x']] });
    await addMeasurement(makeCtx(fake), 's', { ...M, weightKg: null }, 'me@x');
    expect(fake.growthRows()).toHaveLength(2);
    expect(fake.growthRows()[1][2]).toBe(''); // blank weight written as ''
    expect(fake.requests.some((r) => r.op === 'batchUpdate' &&
      r.requests.some((q) => q.addSheet))).toBe(false);
  });

  it('deletes the row holding the id from the Growth grid, not Log', async () => {
    const fake = new FakeSheets('s', {
      log: threeEvents(),
      growth: [['G1', 46000, 4.1, '', '', 'p@x'], ['G2', 46030, 5.0, '', '', 'p@x']],
    });
    await deleteMeasurement(makeCtx(fake), 's', 'G1');
    expect(fake.growthRows().map((r) => r[0])).toEqual(['G2']);
    expect(fake.logRows()).toHaveLength(3);
    const del = fake.requests.find((r) => r.op === 'batchUpdate' &&
      r.requests.some((q) => q.deleteDimension));
    expect(del.requests[0].deleteDimension.range.sheetId).toBe(333);
  });

  it('fetchGrowthState reads measurements + settings together', async () => {
    const fake = new FakeSheets('s', {
      settings: [['baby_sex', 'girl']],
      growth: [['G1', 46234.0, 5.42, 58.5, 'clinic', 'p@x']],
    });
    const { measurements, settings } = await fetchGrowthState(makeCtx(fake), 's');
    expect(settings.baby_sex).toBe('girl');
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({ id: 'G1', weightKg: 5.42, heightCm: 58.5 });
    expect(typeof measurements[0].dateWall).toBe('number');
  });

  it('fetchGrowthState treats a missing Growth tab as empty, settings intact', async () => {
    const fake = new FakeSheets('s', { settings: [['breastfeed_ml', 75]] });
    const { measurements, settings, foreignGrowth } = await fetchGrowthState(makeCtx(fake), 's');
    expect(measurements).toEqual([]);
    expect(foreignGrowth).toBe(false);
    expect(settings.breastfeed_ml).toBe(75);
  });

  it('repairs a half-created tab: header write failed once, next write heals it', async () => {
    // Crash simulation: the first header PUT dies after addSheet succeeded,
    // leaving a headerless Growth tab. The next write must notice and write
    // the header before appending — not short-circuit on tab existence.
    const fake = new FakeSheets('s');
    let failPut = true;
    const realFetch = fake.fetch;
    fake.fetch = async (url, opts) => {
      const path = decodeURIComponent(new URL(url).pathname);
      if (failPut && (opts.method || 'GET') === 'PUT' && path.includes('/values/Growth!A1')) {
        failPut = false;
        return new Response('{}', { status: 500 });
      }
      return realFetch(url, opts);
    };
    await expect(addMeasurement(makeCtx(fake), 's', M, 'me@x')).rejects.toThrow();
    expect(fake.tabs.Growth).toEqual([]); // the half-created state
    await addMeasurement(makeCtx(fake), 's', M, 'me@x');
    expect(fake.tabs.Growth[0][0]).toBe('id'); // header healed
    expect(fake.growthRows()).toHaveLength(1);
    expect(fake.growthRows()[0][2]).toBe(5.42);
  });

  it("refuses to write into a hand-made 'Growth' tab and reads none of it", async () => {
    const fake = new FakeSheets('s');
    fake.tabs.Growth = [['Date', 'Weight (lb)', 'Head circ'], ['01/08/2026', 11.9, 37]];
    await expect(addMeasurement(makeCtx(fake), 's', M, 'me@x'))
      .rejects.toThrow(/rename or clear/);
    expect(fake.tabs.Growth).toHaveLength(2); // untouched
    const { measurements, foreignGrowth } = await fetchGrowthState(makeCtx(fake), 's');
    expect(measurements).toEqual([]); // no garbage rows, no live delete targets
    expect(foreignGrowth).toBe(true);
  });

  it('drops hand-edited junk values on read: text and wrong-unit numbers → null', async () => {
    const fake = new FakeSheets('s', {
      growth: [
        ['G1', 46234.0, '5.4 kg', 58.5, '', 'p@x'],  // text weight → NaN
        ['G2', 46235.0, 5400, -1, '', 'p@x'],        // grams / negative
      ],
    });
    const { measurements } = await fetchGrowthState(makeCtx(fake), 's');
    expect(measurements[0].weightKg).toBeNull();
    expect(measurements[0].heightCm).toBe(58.5);
    expect(measurements[1].weightKg).toBeNull();
    expect(measurements[1].heightCm).toBeNull();
  });
});

describe('createTrackerSheet', () => {
  it('creates Log, Settings and Growth with headers and date formats', async () => {
    const fake = new FakeSheets('s');
    const id = await createTrackerSheet(makeCtx(fake));
    expect(id).toBe('s');
    expect(fake.tabs.Log[0][0]).toBe('id');
    expect(fake.tabs.Growth[0]).toEqual(['id', 'date', 'weight_kg', 'height_cm', 'notes', 'logged_by']);
    expect(fake.tabs.Settings.map((r) => r[0])).toContain('breastfeed_ml');
    const fmt = fake.requests.find((r) => r.op === 'batchUpdate' &&
      r.requests.some((q) => q.repeatCell));
    const targets = fmt.requests.map((q) => q.repeatCell.range.sheetId);
    expect(targets).toEqual([111, 333]); // Log datetime cols + Growth date col
  });
});

describe('shareSheet — Drive permission for a partner', () => {
  it('POSTs a writer permission with a notification email', async () => {
    let seen = null;
    const ctx = makeCtx(async (url, opts) => {
      seen = { url: new URL(url), body: JSON.parse(opts.body), method: opts.method };
      return new Response('{}', { status: 200 });
    });
    await shareSheet(ctx, 'sheet123', 'partner@example.com');
    expect(seen.method).toBe('POST');
    expect(seen.url.pathname).toBe('/drive/v3/files/sheet123/permissions');
    expect(seen.url.searchParams.get('sendNotificationEmail')).toBe('true');
    expect(seen.url.searchParams.get('emailMessage')).toMatch(/tinyloops\.app/);
    expect(seen.body).toMatchObject({
      role: 'writer', type: 'user', emailAddress: 'partner@example.com',
    });
  });

  it('400 (bad address) gets a share-specific message; every failure carries .status', async () => {
    const ctxWith = (status) => makeCtx(async () =>
      new Response('{"error":{"message":"internal detail"}}', { status }));
    await expect(shareSheet(ctxWith(400), 's', 'x@y.z'))
      .rejects.toThrow(/didn't accept that email/);
    // the /api/share route soft-fails on any non-400 status (Drive share is
    // best-effort), so the status must survive on the thrown error
    const err400 = await shareSheet(ctxWith(400), 's', 'x@y.z').catch((e) => e);
    expect(err400.status).toBe(400);
    const err403 = await shareSheet(ctxWith(403), 's', 'x@y.z').catch((e) => e);
    expect(err403.status).toBe(403);
  });
});
