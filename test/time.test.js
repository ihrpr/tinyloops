import { describe, it, expect } from 'vitest';
import {
  serialToWallMs, wallMsToSerial, wallMsToIso, isoToWallMs, cellToWallMs,
  dayStart, wallMsToDate,
} from '../server/time.js';

// Known serials (Google Sheets epoch 1899-12-30):
//   25569   = 1970-01-01 00:00
//   43831   = 2020-01-01 00:00
describe('serial golden values', () => {
  it('serial 25569 is the Unix epoch wall time', () => {
    expect(serialToWallMs(25569)).toBe(Date.UTC(1970, 0, 1));
    expect(wallMsToIso(serialToWallMs(25569))).toBe('1970-01-01T00:00');
  });

  it('serial 43831 is 2020-01-01 00:00', () => {
    expect(wallMsToIso(serialToWallMs(43831))).toBe('2020-01-01T00:00');
  });

  it('fractional serials carry the time of day', () => {
    expect(wallMsToIso(serialToWallMs(43831.75))).toBe('2020-01-01T18:00');
    const s1402 = 43831 + (14 * 60 + 2) / 1440;
    expect(wallMsToIso(serialToWallMs(s1402))).toBe('2020-01-01T14:02');
  });

  it('writes the exact serial Sheets displays as that wall time', () => {
    // 2020-01-01 18:00 → 43831.75, no float surprises
    expect(wallMsToSerial(isoToWallMs('2020-01-01T18:00'))).toBeCloseTo(43831.75, 9);
  });
});

describe('round trips', () => {
  const isos = [
    '2026-08-29T14:02', '2026-01-01T00:00', '2026-12-31T23:59',
    '2026-03-29T01:30', '2026-10-25T02:00', // European DST switch days — wall clock, no jumps
    '2024-02-29T12:00', // leap day
  ];
  for (const iso of isos) {
    it(`iso → wall → serial → wall → iso: ${iso}`, () => {
      const wall = isoToWallMs(iso);
      const serial = wallMsToSerial(wall);
      expect(wallMsToIso(serialToWallMs(serial))).toBe(iso);
    });
  }

  it('survives serial float noise (minute-resolution serials)', () => {
    for (let m = 0; m < 1440; m += 7) {
      const serial = 46000 + m / 1440;
      const wall = serialToWallMs(serial);
      expect(wall % 60000).toBe(0); // whole minutes stay whole
      expect(wallMsToIso(serialToWallMs(wallMsToSerial(wall)))).toBe(wallMsToIso(wall));
    }
  });
});

describe('strict validation — rejects rollover and out-of-range', () => {
  const bad = [
    '2026-08-29T14:99', // minute 99
    '2026-13-05',       // month 13
    '2026-00-05',       // month 0
    '2026-01-32',       // day 32
    '2026-02-30',       // Feb 30 (rollover)
    '2026-01-00',       // day 0
    '2026-08-29T24:00', // hour 24
    '0030-01-01',       // 2-digit-year trap
    '1969-12-31',       // before the epoch window
    '2201-01-01',       // after the window
    'garbage', '2026/08/29', '29-08-2026',
  ];
  for (const v of bad) {
    it(`rejects ${v}`, () => expect(isoToWallMs(v)).toBeNull());
  }

  it('accepts a real leap day but rejects the non-leap one', () => {
    expect(isoToWallMs('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
    expect(isoToWallMs('2026-02-29')).toBeNull();
  });
});

describe('cell parsing', () => {
  it('numbers are serials', () => {
    expect(cellToWallMs(43831)).toBe(Date.UTC(2020, 0, 1));
  });
  it('legacy naive ISO strings still parse', () => {
    expect(cellToWallMs('2026-08-29T14:02')).toBe(Date.UTC(2026, 7, 29, 14, 2));
    expect(cellToWallMs('2026-08-29 14:02:30')).toBe(Date.UTC(2026, 7, 29, 14, 2, 30));
  });
  it('blank and junk are null', () => {
    expect(cellToWallMs('')).toBeNull();
    expect(cellToWallMs(null)).toBeNull();
    expect(cellToWallMs('29/08/2026')).toBeNull(); // locale strings never accepted
  });
});

describe('day math', () => {
  it('dayStart floors to wall midnight', () => {
    const w = isoToWallMs('2026-08-29T14:02');
    expect(wallMsToIso(dayStart(w))).toBe('2026-08-29T00:00');
    expect(wallMsToDate(w)).toBe('2026-08-29');
  });
  it('bare dates parse as midnight', () => {
    expect(isoToWallMs('2026-08-29')).toBe(Date.UTC(2026, 7, 29));
  });
});
