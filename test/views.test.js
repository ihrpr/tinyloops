import { describe, it, expect } from 'vitest';
import { buildHome, buildStats, buildDay, buildRhythm } from '../server/views.js';
import { isoToWallMs } from '../server/time.js';

const NOW = isoToWallMs('2026-08-29T14:00');
const SETTINGS = { breastfeed_ml: 60, enabled_types: 'feed,bottle,sleep,play,pump,wet,dirty' };

let seq = 0;
function ev(type, startIso, o = {}) {
  const startWall = isoToWallMs(startIso);
  const durationMin = o.durationMin ?? null;
  return {
    id: 'e' + (seq++), type, startWall,
    endWall: o.open ? null : durationMin != null ? startWall + durationMin * 60000 : null,
    durationMin, side: o.side || '', amountMl: o.amountMl ?? null,
    notes: o.notes || '', loggedBy: o.by || 'partner@example.com',
    formulaMl: o.formulaMl ?? null,
  };
}

const newestFirst = (events) => [...events].sort((a, b) => b.startWall - a.startWall);

describe('buildHome', () => {
  const events = newestFirst([
    ev('feed', '2026-08-29T13:30', { open: true, side: 'L' }),
    ev('feed', '2026-08-29T09:00', { durationMin: 20, side: 'R' }),
    ev('bottle', '2026-08-29T11:00', { amountMl: 80, formulaMl: 40 }),
    ev('pump', '2026-08-29T08:00', { amountMl: 90 }),
    ev('sleep', '2026-08-29T10:00', { durationMin: 60 }),
    ev('wet', '2026-08-29T07:00'),
    ev('dirty', '2026-08-28T22:00'),
    ev('feed', '2026-08-28T20:00', { durationMin: 15, side: 'both' }),
    ev('feed', '2026-08-20T12:00', { durationMin: 10, side: 'L' }), // outside the list window
  ]);
  const home = buildHome(events, SETTINGS, NOW);

  it('names the day', () => {
    expect(home.topDate).toBe('Saturday 29 August');
  });

  it('shows the open feed as a running timer', () => {
    expect(home.open).toHaveLength(1);
    expect(home.open[0].label).toBe('Breastfeed · L');
    expect(home.open[0].elapsed).toBe('30m');
    expect(home.open[0].stale).toBe(false);
    expect(home.open[0].raw.start).toBe('2026-08-29T13:30');
  });

  it('flags forgotten timers as stale', () => {
    const stale = buildHome(
      newestFirst([ev('feed', '2026-08-29T10:00', { open: true })]), SETTINGS, NOW);
    expect(stale.open[0].stale).toBe(true); // 4h feed > 120min threshold
    expect(stale.open[0].sub).toContain('forgot to stop?');
  });

  it('computes today’s milk with the assumed breastfeed amount', () => {
    const milk = home.summary.rows.find((r) => r.label === 'Milk today');
    // 2 feeds today (one open) ×60 + 80 bottle + 40 formula = 240
    expect(milk.value).toBe('≈240ml');
    const subs = home.summary.rows.filter((r) => r.kind === 'sub');
    expect(subs.map((s) => `${s.label}: ${s.value}`)).toEqual([
      'Breastfed: 2× · ≈120ml', 'Bottle milk: 80ml', 'Formula: 40ml',
    ]);
  });

  it('reports feeding-now on the milk row while a feed runs', () => {
    // recency rides on the type rows — no standalone "Last ate" row
    expect(home.summary.rows.find((r) => r.label === 'Last ate')).toBeUndefined();
    expect(home.summary.rows.find((r) => r.label === 'Milk today').ago).toBe('feeding now');
  });

  it('names the last source on the milk row once nothing is running', () => {
    const h = buildHome(newestFirst([
      ev('bottle', '2026-08-29T11:00', { amountMl: 80 }),
      ev('feed', '2026-08-29T09:00', { durationMin: 20, side: 'R' }),
    ]), SETTINGS, NOW);
    expect(h.summary.rows.find((r) => r.label === 'Milk today').ago).toBe('3h ago (bottle)');
  });

  it('counts nappies and sleep', () => {
    expect(home.summary.rows.find((r) => r.label === 'Nappies').value).toBe('1 wet · 0 dirty');
    const sleep = home.summary.rows.find((r) => r.label === 'Sleep');
    expect(sleep.value).toBe('1h');
    expect(sleep.ago).toBe('awake for 3h');  // slept 10:00–11:00, now 14:00
  });

  it('groups the list into Today and Yesterday only', () => {
    expect(home.list.map((g) => g.day)).toEqual(['Today', 'Yesterday']);
    expect(home.list[0].entries.map((e) => e.time)).toEqual(
      ['13:30', '11:00', '10:00', '09:00', '08:00', '07:00']);
    expect(home.list[1].entries).toHaveLength(2);
  });

  it('suggests the opposite side from the last recorded feed', () => {
    // newest feed with a side is the open one (L) → suggest R
    expect(home.sideHint.suggest).toBe('R');
    expect(home.sideHint.text).toContain('left');
  });

  it('hides disabled types from the grid but keeps their data', () => {
    const h = buildHome(events, { ...SETTINGS, enabled_types: 'feed,wet' }, NOW);
    expect(h.types.filter((t) => t.enabled).map((t) => t.key)).toEqual(['feed', 'wet']);
    expect(h.settings.enabledTypes).toEqual(['feed', 'wet']);
  });

  it('handles the empty sheet', () => {
    const h = buildHome([], SETTINGS, NOW);
    expect(h.summary.empty).toBe(true);
    expect(h.list).toEqual([]);
    expect(h.open).toEqual([]);
  });
});

describe('buildStats', () => {
  const from = isoToWallMs('2026-08-23');
  const to = isoToWallMs('2026-08-29');
  const events = newestFirst([
    ev('feed', '2026-08-29T09:00', { durationMin: 20 }),
    ev('feed', '2026-08-29T12:00', { durationMin: 20 }),
    ev('bottle', '2026-08-29T11:00', { amountMl: 80, formulaMl: 40 }),
    ev('bottle', '2026-08-25T11:00', { amountMl: 100 }),
    ev('pump', '2026-08-23T08:00', { amountMl: 10 }),
    ev('pump', '2026-08-26T08:00', { amountMl: 40 }),
    ev('pump', '2026-08-29T08:00', { amountMl: 70 }),
  ]);
  const s = buildStats(events, SETTINGS, from, to);

  it('covers the inclusive range', () => {
    expect(s.days).toHaveLength(7);
    expect(s.from).toBe('2026-08-23');
    expect(s.to).toBe('2026-08-29');
    expect(s.showVals).toBe(true);
    expect(s.labelStep).toBe(1);
  });

  it('aggregates each day', () => {
    const last = s.days[6];
    expect(last.date).toBe('2026-08-29');
    expect(last.feedCount).toBe(3); // 2 feeds + 1 bottle
    expect(last.bfMl).toBe(120);
    expect(last.bmMl).toBe(80);
    expect(last.fMl).toBe(40);
    expect(last.totalMl).toBe(240);
    expect(s.days[2].totalMl).toBe(100); // the lone 25th bottle
    expect(s.milk.max).toBe(240);
    expect(s.days[0].pumpMl).toBe(10);
  });

  it('fits the pump trend (10ml/day slope here)', () => {
    // pump totals 10,0,0,40,0,0,70 → least squares slope = 5.7ml/day…
    // verify against an independent computation instead of magic numbers
    const ys = [10, 0, 0, 40, 0, 0, 70];
    const meanY = ys.reduce((a, b) => a + b) / 7;
    const slope = ys.reduce((a, y, i) => a + (i - 3) * (y - meanY), 0) /
      ys.reduce((a, _, i) => a + (i - 3) ** 2, 0);
    expect(s.pump.trend.y0).toBeCloseTo(Math.max(0, meanY - 3 * slope), 6);
    expect(s.pump.trend.y1).toBeCloseTo(Math.min(70, meanY + 3 * slope), 6);
    expect(s.pump.note).toContain('avg ' + Math.round(meanY) + 'ml/day');
  });

  it('labels denser ranges more sparsely', () => {
    const wide = buildStats([], SETTINGS, isoToWallMs('2026-06-01'), isoToWallMs('2026-08-29'));
    expect(wide.days.length).toBe(90);
    expect(wide.labelStep).toBe(10);
    expect(wide.showVals).toBe(false);
    expect(wide.milk.any).toBe(false);
  });
});

describe('free text travels as raw data (client is the single escape boundary)', () => {
  it('passes notes through verbatim — no server-side escaping (avoids double-escape)', () => {
    const events = newestFirst([
      ev('feed', '2026-08-25T09:00', { notes: 'a & b <c>', by: 'p@x.com' }),
    ]);
    const day = buildDay(events, isoToWallMs('2026-08-25'), NOW);
    // the server must NOT HTML-escape: it would compound with the client's
    // esc() and render "a &amp; b" to the user
    expect(day.entries[0].details).toContain('a & b <c>');
    expect(day.entries[0].details).not.toContain('&amp;');
    // the edit modal needs the true text too (set via .value, not innerHTML)
    expect(day.entries[0].raw.notes).toBe('a & b <c>');
  });
});

describe('buildDay', () => {
  it('returns one day’s entries with labels', () => {
    const events = newestFirst([
      ev('feed', '2026-08-25T09:00', { durationMin: 20, side: 'L' }),
      ev('wet', '2026-08-25T10:00'),
      ev('feed', '2026-08-26T09:00', { durationMin: 20 }),
    ]);
    const day = buildDay(events, isoToWallMs('2026-08-25'), NOW);
    expect(day.label).toBe('Tue 25 Aug');
    expect(day.entries).toHaveLength(2);
    expect(day.entries.map((e) => e.time)).toEqual(['10:00', '09:00']);
    expect(day.entries[1].details).toBe('left · by partner');
  });
});

describe('solids', () => {
  const SOLID_SETTINGS = { ...SETTINGS, enabled_types: SETTINGS.enabled_types + ',solid' };
  const events = newestFirst([
    ev('solid', '2026-08-29T12:30', { side: 'some', notes: 'carrot, porridge' }),
    ev('solid', '2026-08-29T08:00', { side: 'taste', notes: 'Carrot' }),
    ev('solid', '2026-08-27T12:00', { side: 'lots', notes: 'baby rice' }),
    ev('feed', '2026-08-29T09:00', { durationMin: 20, side: 'L' }),
  ]);

  it('renders eaten amount, not a nursing side, in the entry details', () => {
    const day = buildDay(events, isoToWallMs('2026-08-29'), NOW);
    const solid = day.entries.find((e) => e.type === 'solid' && e.time === '12:30');
    expect(solid.details).toContain('ate some');
    expect(solid.details).toContain('carrot, porridge');
    expect(solid.details).not.toContain('left'); // 'some' never parsed as a side
  });

  it('summarizes today: count, last-ago, and deduped foods', () => {
    const home = buildHome(events, SOLID_SETTINGS, NOW);
    const row = home.summary.rows.find((r) => r.label === 'Solids');
    expect(row.ago).toBe('1h 30m ago');
    expect(row.value).toContain('2×');
    // 'carrot' appears in both meals but with different casing — listed once
    expect(row.value.toLowerCase().match(/carrot/g)).toHaveLength(1);
  });

  it('hides the summary row when solids are disabled and none are logged', () => {
    const home = buildHome(
      newestFirst([ev('feed', '2026-08-29T09:00', { durationMin: 10, side: 'L' })]),
      SETTINGS, NOW);
    expect(home.summary.rows.find((r) => r.label === 'Solids')).toBeUndefined();
  });

  it('builds the all-time foods-tried list: grouped, counted, newest first taste on top', () => {
    const from = isoToWallMs('2026-08-28'); // range EXCLUDES the baby-rice day
    const { foods } = buildStats(events, SOLID_SETTINGS, from, isoToWallMs('2026-08-29'));
    expect(foods.map((f) => f.food)).toEqual(['porridge', 'Carrot', 'baby rice']);
    const carrot = foods.find((f) => f.food === 'Carrot');
    expect(carrot.count).toBe(2);        // case-insensitive grouping
    expect(carrot.first).toBe('Today');  // first-typed casing, earliest date
    expect(foods.find((f) => f.food === 'baby rice').count).toBe(1); // all-time despite range
  });

  it('ignores blank tokens and non-solid notes in the foods list', () => {
    const { foods } = buildStats(newestFirst([
      ev('solid', '2026-08-29T12:00', { notes: ' pear ,, ' }),
      ev('feed', '2026-08-29T09:00', { notes: 'carrot', durationMin: 5 }),
      ev('solid', '2026-08-29T08:00', { notes: '' }), // meal logged without food
    ]), SOLID_SETTINGS, isoToWallMs('2026-08-29'), isoToWallMs('2026-08-29'));
    expect(foods).toEqual([{ food: 'pear', first: 'Today', count: 1 }]);
  });
});

describe('solids food chips (home payload)', () => {
  const SOLID_SETTINGS = { ...SETTINGS, enabled_types: SETTINGS.enabled_types + ',solid' };

  it('puts tried foods first, most recently eaten first, then untried presets', () => {
    const home = buildHome(newestFirst([
      ev('solid', '2026-08-29T12:00', { notes: 'dragon fruit, banana' }),
      ev('solid', '2026-08-27T12:00', { notes: 'carrot' }),
    ]), SOLID_SETTINGS, NOW);
    const chips = home.solidFoods;
    expect(chips.slice(0, 3).map((c) => c.name)).toEqual(['dragon fruit', 'banana', 'carrot']);
    expect(chips.slice(0, 3).every((c) => c.tried)).toBe(true);
    // presets follow, minus the already-tried ones
    expect(chips.filter((c) => c.name === 'banana')).toHaveLength(1);
    expect(chips.some((c) => c.name === 'apple' && !c.tried)).toBe(true);
    // preset foods keep their emoji; unknown custom food gets the fallback
    expect(chips.find((c) => c.name === 'banana').emoji).toBe('🍌');
    expect(chips.find((c) => c.name === 'carrot').emoji).toBe('🥕');
    expect(chips.find((c) => c.name === 'dragon fruit').emoji).toBe('🍽️');
  });

  it('sends no chips when solids are disabled', () => {
    const home = buildHome([], SETTINGS, NOW);
    expect(home.solidFoods).toEqual([]);
  });
});

describe('buildRhythm', () => {
  it('hides the section when nothing relevant was logged recently', () => {
    expect(buildRhythm([], SETTINGS, NOW).any).toBe(false);
    expect(buildRhythm(newestFirst([ev('wet', '2026-08-29T09:00')]), SETTINGS, NOW).any)
      .toBe(false);
    expect(buildRhythm(newestFirst([ev('sleep', '2026-08-01T20:00', { durationMin: 60 })]),
      SETTINGS, NOW).any).toBe(false); // >14 days old
  });

  it('splits sleeps at midnight and clips open sleeps to now', () => {
    const r = buildRhythm(newestFirst([
      ev('sleep', '2026-08-28T22:00', { durationMin: 240 }), // 22:00 → 02:00
      ev('sleep', '2026-08-29T13:00', { open: true }),       // running, now = 14:00
      ev('feed', '2026-08-29T09:00', { durationMin: 10 }),
    ]), SETTINGS, NOW);
    expect(r.any).toBe(true);
    expect(r.nowMin).toBe(14 * 60);
    const fri = r.days[5], sat = r.days[6];
    expect(fri.name).toBe('Fri');
    expect(fri.spans).toEqual([{ a: 22 * 60, b: 24 * 60 }]);
    expect(sat.name).toBe('Today');
    expect(sat.today).toBe(true);
    expect(sat.spans).toEqual([{ a: 0, b: 2 * 60 }, { a: 13 * 60, b: 14 * 60 }]);
    expect(sat.feeds).toEqual([9 * 60]);
  });

  it('ships a pageable week of day strips in the home summary', () => {
    const { summary } = buildHome(newestFirst([
      ev('sleep', '2026-08-28T22:00', { durationMin: 240 }), // night tail → 02:00
      ev('sleep', '2026-08-29T13:00', { open: true }),       // running, now = 14:00
      ev('feed', '2026-08-29T09:00', { durationMin: 10 }),
      ev('bottle', '2026-08-29T11:00', { amountMl: 80, formulaMl: 40 }),
      ev('pump', '2026-08-29T08:00', { amountMl: 90 }),
      ev('feed', '2026-08-26T10:00', { durationMin: 15 }),   // three days back
    ]), SETTINGS, NOW);
    expect(summary.days).toHaveLength(7);
    expect(summary.nowMin).toBe(14 * 60);

    const today = summary.days[6];
    expect(today.name).toBe('Today');
    expect(today.today).toBe(true);
    expect(today.spans).toEqual([{ a: 0, b: 2 * 60 }, { a: 13 * 60, b: 14 * 60 }]);
    expect(today.feeds).toEqual([9 * 60, 11 * 60]);
    expect(today.rows).toBeUndefined(); // today's rows are summary.rows

    // paging back: past days carry the SAME row layout as today, minus the
    // now-statuses. Yesterday holds the pre-midnight half of the night sleep.
    const yesterday = summary.days[5];
    expect(yesterday.name).toBe('Yesterday');
    expect(yesterday.spans).toEqual([{ a: 22 * 60, b: 24 * 60 }]);
    const ySleep = yesterday.rows.find((r) => r.label === 'Sleep');
    expect(ySleep.value).toBe('2h');
    expect(ySleep.ago).toBe(''); // no awake-for on a past day
    expect(yesterday.rows.every((r) => !r.ago)).toBe(true); // no recency on past days

    const wed = summary.days[3];
    expect(wed.name).toBe('Wed 26 Aug');
    expect(wed.rows.find((r) => r.label === 'Milk').value).toBe('≈60ml');
    expect(wed.rows.find((r) => r.kind === 'sub').value).toBe('1× · ≈60ml');

    // an untouched day pages to an empty row list
    expect(summary.days[0].rows).toEqual([]);
  });

  it('drops the ≈ when no breastfeeds contribute to the milk total', () => {
    const { summary } = buildHome(newestFirst([
      ev('bottle', '2026-08-29T11:00', { amountMl: 80 }),
    ]), SETTINGS, NOW);
    expect(summary.rows.find((r) => r.label === 'Milk today').value).toBe('80ml');
  });

  it('omits the day strips while the whole week is empty', () => {
    const { summary } = buildHome(newestFirst([
      ev('wet', '2026-08-29T09:00'),
      ev('sleep', '2026-08-10T20:00', { durationMin: 600 }), // beyond the week
    ]), SETTINGS, NOW);
    expect(summary.empty).toBe(false);
    expect(summary.days).toBe(null);
  });

  it('computes trend tiles over complete days, ignoring days before tracking began', () => {
    // 15–28 Aug: night 20:00→06:00, naps 09:00 and 12:00, a feed and a bottle
    const evs = [];
    for (let day = 15; day <= 28; day++) {
      const dd = String(day).padStart(2, '0');
      evs.push(ev('sleep', `2026-08-${dd}T20:00`, { durationMin: 600 }));
      evs.push(ev('sleep', `2026-08-${dd}T09:00`, { durationMin: 60 }));
      evs.push(ev('sleep', `2026-08-${dd}T12:00`, { durationMin: 60 }));
      evs.push(ev('feed', `2026-08-${dd}T08:00`, { durationMin: 10 }));
      evs.push(ev('bottle', `2026-08-${dd}T15:00`, { amountMl: 100 }));
    }
    const r = buildRhythm(newestFirst(evs), SETTINGS, NOW);
    const tile = (label) => r.tiles.find((t) => t.label === label);

    // current window (22–28 Aug) has 12h/day; the previous window's first day
    // (15 Aug) misses its inbound night, so last week averaged lower
    expect(tile('Sleep per day').value).toBe('12h');
    expect(tile('Sleep per day').delta).toBe('▲ 51m vs last week');

    // every tracked night is one unbroken 20:00→06:00 stretch
    expect(tile('Longest night stretch').value).toBe('10h');
    expect(tile('Longest night stretch').delta).toBe('≈ same as last week');

    expect(tile('Feeds per day').value).toBe('2');
    expect(tile('Feeds per day').delta).toBe('≈ same as last week');

    // the only daytime gap between sleeps is 10:00 → 12:00
    expect(tile('Typical wake window').value).toBe('2h');
    expect(tile('Typical wake window').delta).toBe('≈ same as last week');
  });
});
