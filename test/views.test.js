import { describe, it, expect } from 'vitest';
import { buildHome, buildStats, buildDay } from '../server/views.js';
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

  it('reports feeding-now over ago-strings while a feed runs', () => {
    expect(home.summary.rows.find((r) => r.label === 'Last ate').value).toBe('feeding now');
    expect(home.summary.rows.find((r) => r.label === 'Breasts emptied').value).toBe('feeding now');
  });

  it('counts nappies and sleep', () => {
    expect(home.summary.rows.find((r) => r.label === 'Nappies').value).toBe('1 wet · 0 dirty');
    expect(home.summary.rows.find((r) => r.label === 'Sleep').value).toBe('1h');
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
