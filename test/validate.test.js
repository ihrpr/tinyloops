import { describe, it, expect } from 'vitest';
import {
  clampInt, safeText, eventParams, shareEmail, growthParams, profileParams,
  ValidationError, MAX_ML,
} from '../server/validate.js';
import { isoToWallMs } from '../server/time.js';

describe('clampInt', () => {
  it('accepts and rounds in-range values', () => {
    expect(clampInt('60', MAX_ML)).toBe(60);
    expect(clampInt(60.7, MAX_ML)).toBe(61);
  });
  it('rejects out-of-range, negative, and non-finite', () => {
    expect(clampInt(1e15, MAX_ML)).toBeNull();      // absurd magnitude
    expect(clampInt('1e999', MAX_ML)).toBeNull();   // → Infinity
    expect(clampInt(-5, MAX_ML)).toBeNull();
    expect(clampInt('NaN', MAX_ML)).toBeNull();
    expect(clampInt('abc', MAX_ML)).toBeNull();
  });
  it('treats blank as absent', () => {
    expect(clampInt('', MAX_ML)).toBeNull();
    expect(clampInt(null, MAX_ML)).toBeNull();
  });
});

describe('safeText — CSV/formula-injection guard', () => {
  it('prefixes leading formula triggers with an apostrophe', () => {
    expect(safeText('=HYPERLINK("http://evil","x")')).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(safeText('+1+1')).toBe("'+1+1");
    expect(safeText('-2')).toBe("'-2");
    expect(safeText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeText('\t=x')).toBe("'\t=x");
  });
  it('leaves ordinary notes untouched', () => {
    expect(safeText('Mucus')).toBe('Mucus');
    expect(safeText('slept 2h, woke crying')).toBe('slept 2h, woke crying');
  });
  it('caps length', () => {
    expect(safeText('x'.repeat(1000)).length).toBe(500);
  });
});

describe('eventParams', () => {
  it('accepts a valid feed', () => {
    const p = eventParams({ type: 'feed', start: '2026-08-29T14:02', side: 'L' });
    expect(p).toMatchObject({ type: 'feed', side: 'L' });
    expect(p.startWall).toBe(Date.UTC(2026, 7, 29, 14, 2));
  });
  it('rejects unknown type', () => {
    expect(() => eventParams({ type: 'hack', start: '2026-08-29T14:02' }))
      .toThrow(ValidationError);
  });
  it('rejects an invalid start time', () => {
    expect(() => eventParams({ type: 'feed', start: '2026-13-45T99:99' }))
      .toThrow(/valid start time/);
  });
  it('drops a bogus side to empty', () => {
    expect(eventParams({ type: 'feed', start: '2026-08-29T14:02', side: 'X' }).side).toBe('');
  });
  it('clamps an absurd duration to absent', () => {
    const p = eventParams({ type: 'sleep', start: '2026-08-29T14:02', durationMin: 1e15 });
    expect(p.durationMin).toBeUndefined();
  });
  it('sanitizes a formula-injection note', () => {
    const p = eventParams({ type: 'feed', start: '2026-08-29T14:02', notes: '=IMPORTXML(1,2)' });
    expect(p.notes.startsWith("'=")).toBe(true);
  });
});

describe('shareEmail', () => {
  it('accepts and trims a plausible address', () => {
    expect(shareEmail(' partner@example.com ')).toBe('partner@example.com');
    expect(shareEmail('a.b+c@sub.domain.co')).toBe('a.b+c@sub.domain.co');
  });
  it('rejects empty, malformed, and oversized input', () => {
    expect(() => shareEmail('')).toThrow(ValidationError);
    expect(() => shareEmail(null)).toThrow(ValidationError);
    expect(() => shareEmail('not-an-email')).toThrow(ValidationError);
    expect(() => shareEmail('two words@x.com')).toThrow(ValidationError);
    expect(() => shareEmail('no-tld@host')).toThrow(ValidationError);
    expect(() => shareEmail('a@b.c' + 'x'.repeat(255))).toThrow(ValidationError);
  });
});

describe('growthParams', () => {
  const NOW = isoToWallMs('2026-08-31T10:00');

  it('accepts a date plus either measure, rounding to sane precision', () => {
    const p = growthParams({ date: '2026-08-30', weightKg: '5.4266', heightCm: '' }, NOW);
    expect(p.weightKg).toBe(5.427);
    expect(p.heightCm).toBeNull();
    expect(p.dateWall).toBe(isoToWallMs('2026-08-30'));
    expect(growthParams({ date: '2026-08-30', heightCm: 58.44 }, NOW).heightCm).toBe(58.4);
  });

  it('rejects a missing or future date', () => {
    expect(() => growthParams({ weightKg: 5 }, NOW)).toThrow(/measurement date/);
    expect(() => growthParams({ date: '2026-09-02', weightKg: 5 }, NOW)).toThrow(/future/);
  });

  it('rejects wrong-unit values instead of silently dropping them', () => {
    expect(() => growthParams({ date: '2026-08-30', weightKg: 5400 }, NOW)) // grams
      .toThrow(/kilograms/);
    expect(() => growthParams({ date: '2026-08-30', heightCm: 0.58 }, NOW)) // metres
      .toThrow(/centimetres/);
  });

  it('requires at least one measure and sanitizes notes', () => {
    expect(() => growthParams({ date: '2026-08-30' }, NOW)).toThrow(/weight, a height/);
    const p = growthParams({ date: '2026-08-30', weightKg: 5, notes: '=SUM(A1)' }, NOW);
    expect(p.notes.startsWith("'=")).toBe(true);
  });
});

describe('profileParams', () => {
  const NOW = isoToWallMs('2026-08-31T10:00');

  it('accepts a plausible birth date and sex', () => {
    expect(profileParams({ birthDate: '2026-05-01', sex: 'girl' }, NOW))
      .toEqual({ birthDate: '2026-05-01', sex: 'girl' });
  });

  it('rejects missing/future/ancient birth dates and unknown sex', () => {
    expect(() => profileParams({ sex: 'boy' }, NOW)).toThrow(ValidationError);
    expect(() => profileParams({ birthDate: '2026-09-15', sex: 'boy' }, NOW))
      .toThrow(/birth date/);
    expect(() => profileParams({ birthDate: '2015-01-01', sex: 'boy' }, NOW))
      .toThrow(/looks wrong/);
    expect(() => profileParams({ birthDate: '2026-05-01', sex: 'other' }, NOW))
      .toThrow(/girl or boy/);
  });
});
