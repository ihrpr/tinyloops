import { describe, it, expect } from 'vitest';
import { buildGrowth, centileLabel, referenceValue } from '../server/growth.js';
import { LMS } from '../server/who-lms.js';
import { isoToWallMs, MS_PER_DAY } from '../server/time.js';

// Published WHO anchors the embedded tables must reproduce exactly
// (WHO Child Growth Standards, weight/length-for-age, birth values).
describe('WHO LMS data', () => {
  it('matches the published birth medians', () => {
    expect(LMS.boy.weight[0]).toEqual([0, 0.3487, 3.3464, 0.14602]);
    expect(LMS.girl.weight[0]).toEqual([0, 0.3809, 3.2322, 0.14171]);
    expect(LMS.boy.length[0][2]).toBe(49.8842);
    expect(LMS.girl.length[0][2]).toBe(49.1477);
  });
});

describe('centile math', () => {
  it('the median value scores as the 50th centile', () => {
    for (const sex of ['girl', 'boy']) {
      for (const measure of ['weight', 'length']) {
        const m = referenceValue(sex, measure, 183); // z=0 → M at 6 months
        expect(centileLabel(sex, measure, 183, m)).toBe('50th');
      }
    }
  });

  it('round-trips the reference centiles', () => {
    expect(centileLabel('boy', 'weight', 365, referenceValue('boy', 'weight', 365, 1.036433)))
      .toBe('85th');
    expect(centileLabel('girl', 'length', 100, referenceValue('girl', 'length', 100, -1.880794)))
      .toBe('3rd');
  });

  it('values on the UK-WHO ⅔-SD lines label as the red-book centiles', () => {
    expect(centileLabel('boy', 'weight', 365, referenceValue('boy', 'weight', 365, 4 / 3)))
      .toBe('91st');
    expect(centileLabel('boy', 'weight', 365, referenceValue('boy', 'weight', 365, -4 / 3)))
      .toBe('9th');
    expect(centileLabel('girl', 'length', 200, referenceValue('girl', 'length', 200, 2)))
      .toBe('98th');
    expect(centileLabel('girl', 'weight', 200, referenceValue('girl', 'weight', 200, -2 / 3)))
      .toBe('25th');
  });

  it('clamps extreme values to <1st / >99th', () => {
    expect(centileLabel('boy', 'weight', 30, 1.5)).toBe('<1st');
    expect(centileLabel('boy', 'weight', 30, 9)).toBe('>99th');
  });

  it('interpolates between sampled ages monotonically', () => {
    const d7 = referenceValue('girl', 'weight', 7);
    const d10 = referenceValue('girl', 'weight', 10);
    const d14 = referenceValue('girl', 'weight', 14);
    expect(d10).toBeGreaterThan(d7);
    expect(d10).toBeLessThan(d14);
  });
});

const NOW = isoToWallMs('2026-08-31T10:00');
const PROFILE = { baby_birth_date: '2026-05-01', baby_sex: 'girl' };
const entry = (id, date, weightKg = null, heightCm = null) => ({
  id, dateWall: isoToWallMs(date), weightKg, heightCm, notes: '', loggedBy: 'p@x.com',
});

describe('buildGrowth', () => {
  it('asks for the profile until birth date and sex exist', () => {
    expect(buildGrowth([], {}, NOW).needsProfile).toBe(true);
    expect(buildGrowth([entry('a', '2026-08-01', 5)], { baby_sex: 'girl' }, NOW))
      .toMatchObject({ needsProfile: true, hasEntries: true });
    // a future birth date can't place anything on the age axis either
    expect(buildGrowth([], { baby_birth_date: '2027-01-01', baby_sex: 'boy' }, NOW).needsProfile)
      .toBe(true);
    expect(buildGrowth([], PROFILE, NOW).needsProfile).toBe(false);
  });

  it('builds curve rows plus measurement rows with tips and centiles', () => {
    const g = buildGrowth([entry('a', '2026-08-01', 5.4, 58.0)], PROFILE, NOW);
    const w = g.charts.weight;
    expect(w.unit).toBe('kg');
    const point = w.data.find((r) => r.y != null);
    expect(point.x).toBeCloseTo(92 / 30.4375, 1); // 92 days old
    expect(point.tip).toMatch(/1 Aug · 5.4 kg · \d+\w+ centile/);
    // measurement rows carry curve values so the centile lines stay unbroken
    expect(point.p50).toBeGreaterThan(point.p2);
    // every row has all nine UK-WHO centiles, ascending
    const keys = ['p004', 'p2', 'p9', 'p25', 'p50', 'p75', 'p91', 'p98', 'p996'];
    expect(w.centiles.map((c) => c.key)).toEqual(keys);
    for (const r of w.data) {
      for (let i = 1; i < keys.length; i++) {
        expect(r[keys[i - 1]]).toBeLessThan(r[keys[i]]);
      }
    }
    expect(w.latest.text).toMatch(/5.4 kg .* centile at 3 months/); // 92 days
    expect(g.charts.length.unit).toBe('cm');
    expect(g.charts.length.empty).toBe(false);
  });

  it('merges a grid-day measurement into the curve row — no duplicate x', () => {
    // duplicate x values give Recharts two tooltip ticks at one pixel and a
    // dead zone on the dot (adversarial-review finding); birth day is always
    // a grid day, so the birth weight is the guaranteed repro
    const g = buildGrowth([entry('a', '2026-05-01', 3.2)], PROFILE, NOW);
    const rows = g.charts.weight.data.filter((r) => r.x === 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].y).toBe(3.2);
    expect(rows[0].tip).toMatch(/centile/);
    expect(rows[0].p50).toBeGreaterThan(rows[0].p004); // still a curve row too
    // and never two rows sharing any x anywhere
    const xs = g.charts.weight.data.map((r) => r.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('windows the x-axis to the baby age, capped at 24 months', () => {
    const g = buildGrowth([], PROFILE, NOW); // 4 months old
    expect(g.charts.weight.xMax).toBeGreaterThanOrEqual(5);
    expect(g.charts.weight.xMax).toBeLessThanOrEqual(7);
    const old = buildGrowth([], { ...PROFILE, baby_birth_date: '2023-01-01' }, NOW);
    expect(old.charts.weight.xMax).toBe(24);
    expect(old.pastStandards).toBe(true);
  });

  it('keeps out-of-range measurements in the table but off the chart', () => {
    const g = buildGrowth([entry('a', '2026-04-01', 3.0)], PROFILE, NOW); // before birth
    expect(g.charts.weight.data.some((r) => r.y != null)).toBe(false);
    expect(g.charts.weight.empty).toBe(true);
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0].age).toBe('—');
  });

  it('lists entries newest first with per-measure centiles', () => {
    const g = buildGrowth([
      entry('a', '2026-05-02', 3.2),
      entry('b', '2026-08-01', null, 60.1),
    ], PROFILE, NOW);
    expect(g.entries.map((e) => e.id)).toEqual(['b', 'a']);
    expect(g.entries[0].weight).toBeNull();
    expect(g.entries[0].height.value).toBe('60.1');
    expect(g.entries[0].height.centile).toMatch(/^\d+\w+$|^[<>]/);
    expect(g.entries[1].weight.centile).toMatch(/^\d+\w+$|^[<>]/);
    expect(g.entries[1].by).toBe('p');
  });

  it('formats ages as days, then weeks, then months', () => {
    const born = (daysAgo) => ({
      baby_birth_date: new Date(NOW - daysAgo * MS_PER_DAY).toISOString().slice(0, 10),
      baby_sex: 'boy',
    });
    expect(buildGrowth([], born(5), NOW).profile.ageLabel).toBe('5 days old');
    expect(buildGrowth([], born(40), NOW).profile.ageLabel).toBe('5 weeks old');
    expect(buildGrowth([], born(200), NOW).profile.ageLabel).toBe('6 months old');
  });
});
