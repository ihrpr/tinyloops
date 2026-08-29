import { describe, it, expect } from 'vitest';
import { FakeSheets, makeCtx } from './fake-sheets.js';
import {
  addEvent, stopEvent, updateEvent, deleteEvent, setSettings,
  fetchState, gapiFetch,
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
