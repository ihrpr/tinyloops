import { describe, it, expect } from 'vitest';
import {
  clampInt, safeText, eventParams, shareEmail, caregiverName, growthParams,
  profileParams, targetSchedule, buildTargetPlan, ValidationError, MAX_ML,
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

describe('caregiverName', () => {
  it('trims and collapses whitespace', () => {
    expect(caregiverName('  Granny   Vera ')).toBe('Granny Vera');
  });
  it('rejects empty or missing names', () => {
    expect(() => caregiverName('')).toThrow(ValidationError);
    expect(() => caregiverName('   ')).toThrow(/name/);
    expect(() => caregiverName(undefined)).toThrow(ValidationError);
  });
  it('caps length at 40 and neutralizes formula triggers (sheet "added by" cell)', () => {
    expect(caregiverName('x'.repeat(80))).toHaveLength(40);
    expect(caregiverName('=SUM(A1)').startsWith("'=")).toBe(true);
  });
});

describe('side vocabulary per type', () => {
  it('solids accept eaten amounts and reject nursing sides', () => {
    expect(eventParams({ type: 'solid', start: '2026-08-29T12:00', side: 'lots' }).side).toBe('lots');
    expect(eventParams({ type: 'solid', start: '2026-08-29T12:00', side: 'L' }).side).toBe('');
  });
  it('feeds accept nursing sides and reject eaten amounts', () => {
    expect(eventParams({ type: 'feed', start: '2026-08-29T12:00', side: 'L' }).side).toBe('L');
    expect(eventParams({ type: 'feed', start: '2026-08-29T12:00', side: 'lots' }).side).toBe('');
  });
  it('sleeps accept night; everything else is the nap default', () => {
    expect(eventParams({ type: 'sleep', start: '2026-08-29T20:00', side: 'night' }).side).toBe('night');
    expect(eventParams({ type: 'sleep', start: '2026-08-29T12:00', side: 'nap' }).side).toBe('');
    expect(eventParams({ type: 'sleep', start: '2026-08-29T12:00', side: 'L' }).side).toBe('');
  });
  it('medicines take no side at all', () => {
    expect(eventParams({ type: 'med', start: '2026-08-29T12:00', side: 'L', notes: 'Calpol 2.5 ml' })
      .side).toBe('');
  });
});

describe('targetSchedule — the target-day plan', () => {
  it('canonicalizes: zero-pads, sorts, tidies spacing', () => {
    expect(targetSchedule({
      targetNaps: '14:00-15:30,8:30 - 10:00',
      targetFeeds: '16:00, 7:00,  10:00',
    })).toEqual({
      targetNaps: '08:30-10:00, 14:00-15:30',
      targetFeeds: '07:00, 10:00, 16:00',
    });
  });
  it('empty input means no plan', () => {
    expect(targetSchedule({})).toEqual({ targetNaps: '', targetFeeds: '' });
    expect(targetSchedule({ targetNaps: '  ', targetFeeds: '' }))
      .toEqual({ targetNaps: '', targetFeeds: '' });
  });
  it('accepts an en-dash between nap times', () => {
    expect(targetSchedule({ targetNaps: '08:30–10:00' }).targetNaps).toBe('08:30-10:00');
  });
  it('names the token it cannot read', () => {
    expect(() => targetSchedule({ targetNaps: '8h30-10:00' })).toThrow(/"8h30-10:00"/);
    expect(() => targetSchedule({ targetFeeds: '25:00' })).toThrow(/"25:00"/);
    expect(() => targetSchedule({ targetFeeds: 'after lunch' })).toThrow(ValidationError);
  });
  it('rejects a backwards or overlapping nap', () => {
    expect(() => targetSchedule({ targetNaps: '10:00-08:30' })).toThrow(ValidationError);
    expect(() => targetSchedule({ targetNaps: '08:30-10:00, 09:45-11:00' }))
      .toThrow(/overlap/);
  });
  it('caps runaway plans', () => {
    const naps = Array.from({ length: 9 }, (_, i) => `0${i}:00-0${i}:30`).join(', ');
    expect(() => targetSchedule({ targetNaps: naps })).toThrow(/8 or fewer/);
    const feeds = Array.from({ length: 17 }, (_, i) => `${String(i).padStart(2, '0')}:00`).join(', ');
    expect(() => targetSchedule({ targetFeeds: feeds })).toThrow(/16 or fewer/);
  });
});

describe('buildTargetPlan — the plan builder', () => {
  // default night window 19:30 → 07:30: awake day 07:30–19:30 (720 min)
  it('spaces naps and feeds evenly through the awake day', () => {
    const p = buildTargetPlan({ naps: '4', feeds: '8' });
    // 25% of 720 min asleep over 4 naps = 45 min each, equal windows between
    expect(p.targetNaps).toBe('09:20-10:05, 11:50-12:35, 14:25-15:10, 16:55-17:40');
    // first feed on waking, last right before the night, even in between
    expect(p.targetFeeds).toBe('07:30, 08:45, 10:50, 12:50, 14:10, 16:10, 18:15, 19:30');
  });

  it('uses the night window from the form, unsaved values included', () => {
    const p = buildTargetPlan({ naps: '0', feeds: '3',
      nightStart: '19:50', nightEnd: '06:30' });
    expect(p.targetFeeds).toBe('06:30, 13:10, 19:50');
  });

  it('a dream feed takes one slot and lands 3h into the night', () => {
    const p = buildTargetPlan({ naps: '0', feeds: '3', dreamFeed: '1',
      nightStart: '19:50', nightEnd: '06:30' });
    expect(p.targetFeeds).toBe('06:30, 19:50, 22:50');
  });

  it('feed gaps stay even — spacing is measured in awake time', () => {
    const p = buildTargetPlan({ naps: '4', feeds: '8', dreamFeed: '1' });
    // naps never squeeze the gaps around them: the day feeds run 1h30–2h15
    // apart, no long gap with a tiny one next to it, none inside a nap
    expect(p.targetFeeds)
      .toBe('07:30, 09:00, 11:15, 13:30, 15:45, 18:00, 19:30, 22:30');
  });

  it('feeds = naps + 2 lands a feed on every nap wake-up', () => {
    const p = buildTargetPlan({ naps: '5', feeds: '7',
      nightStart: '19:50', nightEnd: '06:30' });
    expect(p.targetNaps)
      .toBe('08:10-08:50, 10:30-11:10, 12:50-13:30, 15:10-15:50, 17:30-18:10');
    // wake-up feed, one at the end of each nap, one before the night —
    // the shape of a real nap timetable, with every gap the same
    expect(p.targetFeeds).toBe('06:30, 08:50, 11:10, 13:30, 15:50, 18:10, 19:50');
  });

  it('a single nap gets the full 90 minutes, midday', () => {
    expect(buildTargetPlan({ naps: '1', feeds: '0' }).targetNaps).toBe('12:45-14:15');
  });

  it('the result is already canonical — a round-trip changes nothing', () => {
    const p = buildTargetPlan({ naps: '5', feeds: '7', dreamFeed: '1',
      nightStart: '19:00', nightEnd: '07:00' });
    expect(targetSchedule(p)).toEqual(p);
  });

  it('rejects counts beyond the plan caps, or an all-zero plan', () => {
    expect(() => buildTargetPlan({ naps: '9', feeds: '8' })).toThrow(/0 to 8/);
    expect(() => buildTargetPlan({ naps: '4', feeds: '17' })).toThrow(/0 to 16/);
    expect(() => buildTargetPlan({ naps: '4', feeds: 'lots' })).toThrow(ValidationError);
    expect(() => buildTargetPlan({ naps: '0', feeds: '0' })).toThrow(/at least one/);
  });

  it('needs a night that crosses midnight for the awake day to fit in', () => {
    expect(() => buildTargetPlan({ naps: '2', feeds: '4',
      nightStart: '06:00', nightEnd: '20:00' })).toThrow(/crosses midnight/);
  });
});

describe('bottle leftovers', () => {
  it('keeps the offered amounts and passes the leftover through', () => {
    const p = eventParams({ type: 'bottle', start: '2026-08-29T12:00',
      amountMl: 80, formulaMl: 40, leftoverMl: 30 });
    expect(p.leftoverMl).toBe(30);
    expect(p.side).toBe(''); // the side column stays free
    expect(p.amountMl).toBe(80); // the record stays what was offered
    expect(p.formulaMl).toBe(40);
  });
  it('a zero or missing leftover stays blank', () => {
    expect(eventParams({ type: 'bottle', start: '2026-08-29T12:00',
      amountMl: 80, leftoverMl: 0 }).leftoverMl).toBeUndefined();
    expect(eventParams({ type: 'bottle', start: '2026-08-29T12:00',
      amountMl: 80 }).leftoverMl).toBeUndefined();
  });
  it('rejects a leftover beyond the bottle, or with an empty bottle', () => {
    expect(() => eventParams({ type: 'bottle', start: '2026-08-29T12:00',
      amountMl: 80, formulaMl: 40, leftoverMl: 130 })).toThrow(/more than the 120ml/);
    expect(() => eventParams({ type: 'bottle', start: '2026-08-29T12:00',
      leftoverMl: 30 })).toThrow(/what was in the bottle/);
  });
  it('bottles take no nursing side', () => {
    expect(eventParams({ type: 'bottle', start: '2026-08-29T12:00', side: 'L' }).side).toBe('');
  });
});

describe('medicine entries', () => {
  it('accepts a named medicine, name + dose as one text', () => {
    const p = eventParams({ type: 'med', start: '2026-08-29T12:00', notes: 'Calpol 2.5 ml' });
    expect(p).toMatchObject({ type: 'med', notes: 'Calpol 2.5 ml', side: '' });
  });
  it('rejects a medicine entry with no name', () => {
    expect(() => eventParams({ type: 'med', start: '2026-08-29T12:00' }))
      .toThrow(/Which medicine/);
    expect(() => eventParams({ type: 'med', start: '2026-08-29T12:00', notes: '   ' }))
      .toThrow(ValidationError);
  });
});
