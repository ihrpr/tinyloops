/**
 * Demo mode: ?demo serves the same view endpoints from generated sample
 * data, no sign-in and no sheet. Used for design review and headless
 * screenshots; the client blocks writes in demo mode, so only reads exist.
 */

import { DEFAULT_SETTINGS } from './sheets.js';
import { referenceValue } from './growth.js';
import { dayStart, wallMsToDate, MS_PER_DAY } from './time.js';

export const DEMO_SETTINGS = { ...DEFAULT_SETTINGS };

// The sample set is fixed relative to the current day, so regenerating it on
// every ?demo request wastes CPU (a public, unauthenticated endpoint). Cache
// one generated set per day; the sub-day drift of "now" is irrelevant here.
let cache = null;

export function demoEvents(nowWall) {
  const day = dayStart(nowWall);
  if (cache && cache.day === day) return cache.events;
  const events = generateDemo(nowWall);
  cache = { day, events };
  return events;
}

/**
 * Sample growth data: a girl born ~4 months ago, measured every few weeks,
 * tracking just under the median and drifting gently up. Values are read off
 * the real WHO curves so the demo chart is honest about what the feature
 * shows.
 */
export function demoGrowth(nowWall) {
  const birth = dayStart(nowWall) - 130 * MS_PER_DAY;
  const days = [0, 4, 14, 28, 42, 61, 84, 112, 126];
  const measurements = days.map((d, i) => ({
    id: 'demo-g' + i,
    dateWall: birth + d * MS_PER_DAY,
    weightKg: Math.round(referenceValue('girl', 'weight', d, -0.5 + i * 0.07) * 100) / 100,
    heightCm: i % 2 === 0
      ? Math.round(referenceValue('girl', 'length', d, -0.3 + i * 0.05) * 10) / 10 : null,
    notes: '',
    loggedBy: 'demo@example.com',
  }));
  return {
    measurements,
    settings: { baby_birth_date: wallMsToDate(birth), baby_sex: 'girl' },
  };
}

function generateDemo(nowWall) {
  const out = [];
  const h = 3600000;
  let id = 0;
  const add = (type, agoH, o = {}) => {
    const startWall = nowWall - agoH * h;
    const durationMin = o.durationMin != null ? o.durationMin : null;
    out.push({
      id: 'demo-' + (id++), type, startWall,
      endWall: o.open ? null : durationMin != null ? startWall + durationMin * 60000 : null,
      durationMin, side: o.side || '',
      amountMl: o.amountMl != null ? o.amountMl : null,
      notes: o.notes || '', loggedBy: 'demo@example.com',
      formulaMl: o.formulaMl != null ? o.formulaMl : null,
    });
  };
  add('feed', 0.3, { open: true, side: 'L' }); // running now
  for (let day = 0; day < 95; day++) {
    for (let t = 1; t < 24; t += 3) {
      const ago = day * 24 + t;
      add('feed', ago, { durationMin: 12 + ((t + day) % 4) * 6, side: t % 2 ? 'L' : 'R' });
      if (t % 6 === 1) add('wet', ago - 0.4);
      if (t % 9 === 4) add('dirty', ago - 0.6, { notes: day === 0 ? 'Mucus' : '' });
    }
    add('bottle', day * 24 + 9.5, { amountMl: 60, formulaMl: 30 });
    add('pump', day * 24 + 13, { amountMl: Math.max(20, 62 - day * 2) + (day % 3) * 6 });
    add('sleep', day * 24 + 4, { durationMin: 150 });
    add('play', day * 24 + 11, { durationMin: 25 });
  }
  out.sort((a, b) => b.startWall - a.startWall);
  return out;
}
