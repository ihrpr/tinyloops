/**
 * Milestones view: the render-ready /api/milestones payload.
 *
 * A milestone is an ordinary Log row (type 'milestone'): the notes column
 * holds what happened ("First smile"), the multi-purpose side column its
 * category. Everything the Milestones tab draws — the age ribbon's dot
 * positions, the grouped timeline, labels and counts — is computed here so
 * the client only renders.
 */

import { dayStart, isoToWallMs, wallMsToIso, MS_PER_DAY } from './time.js';
import { fmtAgeAt, calendarMonths } from './growth.js';

// The side-column vocabulary for milestones. '' (no category) is a plain
// "first"; `k` is the client's icon key.
export const MILESTONE_CATS = {
  move:   { label: 'Movement', short: 'Moving' },
  talk:   { label: 'Sounds & words', short: 'Talking' },
  social: { label: 'Smiles & play', short: 'Social' },
  food:   { label: 'Eating', short: 'Eating' },
  body:   { label: 'Teeth & body', short: 'Body' },
};
const OTHER = { label: 'Other firsts', short: 'Other' };
const catOf = (e) => (MILESTONE_CATS[e.side] ? e.side : '');
const iconOf = (cat) => (cat ? 'm-' + cat : 'milestone');

// The classics, roughly in the order they arrive — offered as one-tap chips
// until logged.
const SUGGESTIONS = [
  ['First smile', 'social'], ['Held head up', 'move'], ['First laugh', 'social'],
  ['Rolled over', 'move'], ['First solid food', 'food'], ['First tooth', 'body'],
  ['Sat up unaided', 'move'], ['Babbled', 'talk'], ['Crawled', 'move'],
  ['Waved', 'social'], ['Pulled to stand', 'move'], ['First word', 'talk'],
  ['First steps', 'move'],
];

const title = (e) => String(e.notes || '').trim();

/** The next few classic milestones not logged yet, for the one-tap chips. */
export function milestoneChips(events, max = 6) {
  const have = new Set(events.filter((e) => e.type === 'milestone')
    .map((e) => title(e).toLowerCase()));
  return SUGGESTIONS.filter(([name]) => !have.has(name.toLowerCase()))
    .slice(0, max).map(([name, cat]) => ({ name, cat }));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const fmtDate = (w) => {
  const d = new Date(w);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const DAYS_PER_MONTH = 30.4375;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round4 = (v) => Math.round(v * 10000) / 10000;

function agoLabel(w, nowWall) {
  const days = Math.round((dayStart(nowWall) - dayStart(w)) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 70) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / DAYS_PER_MONTH)} months ago`;
}

/**
 * The ribbon: one horizontal age axis from birth to today, with a dot per
 * milestone — it rescales as the baby grows. Positions are fractions 0–1;
 * dots that would collide stack into rows. Without a birth date the axis
 * runs from the first milestone to today instead.
 */
function buildRibbon(items, birthWall, nowWall) {
  const today = dayStart(nowWall);
  let start, spanDays;
  const ticks = [];
  if (birthWall != null) {
    start = dayStart(birthWall);
    spanDays = Math.max(1, (today - start) / MS_PER_DAY);
    const months = spanDays / DAYS_PER_MONTH;
    ticks.push({ x: 0, label: 'born' });
    if (months < 2) {
      // the first weeks: whole months would leave the axis bare
      for (let w = 1; w * 7 <= spanDays; w++) {
        ticks.push({ x: round4((w * 7) / spanDays), label: `${w}w` });
      }
    } else {
      const step = months <= 8 ? 1 : months <= 16 ? 2 : months <= 30 ? 3 : months <= 60 ? 6 : 12;
      for (let m = step; m <= months; m += step) {
        ticks.push({
          x: round4((m * DAYS_PER_MONTH) / spanDays),
          label: m % 12 === 0 ? `${m / 12}y` : `${m}m`,
        });
      }
    }
  } else {
    const first = items.length ? Math.min(...items.map((i) => i.wall)) : today;
    start = Math.min(dayStart(first), today - 30 * MS_PER_DAY);
    spanDays = (today - start) / MS_PER_DAY;
    const d = new Date(start);
    ticks.push({ x: 0, label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` });
  }
  const xOf = (w) => clamp01((dayStart(w) - start) / MS_PER_DAY / spanDays);

  // oldest first; a dot closer than MIN_GAP to the last one in a row moves
  // up a row (three rows, then they simply overlap)
  const MIN_GAP = 0.045;
  const lastX = [];
  const dots = [...items].sort((a, b) => a.wall - b.wall).map((it) => {
    const x = xOf(it.wall);
    let row = lastX.findIndex((lx) => x - lx >= MIN_GAP);
    if (row === -1) row = lastX.length < 3 ? lastX.length : 0;
    lastX[row] = x;
    return { id: it.id, x: round4(x), row, k: it.k, label: `${it.title} — ${it.when}` };
  });
  return { ticks, dots, nowX: round4(xOf(nowWall)), rows: Math.max(1, lastX.length) };
}

/**
 * events: the whole log (newest first); settings: the sheet's Settings tab
 * (baby_birth_date is shared with the Growth view and places milestones on
 * the age axis — without it the view falls back to calendar dates).
 */
export function buildMilestones(events, settings, nowWall) {
  const parsedBirth = isoToWallMs(String(settings.baby_birth_date || ''));
  const birthWall = parsedBirth != null && parsedBirth <= nowWall ? parsedBirth : null;

  const items = events
    .filter((e) => e.type === 'milestone' && e.startWall != null)
    .map((e) => {
      const cat = catOf(e);
      const aged = birthWall != null && dayStart(e.startWall) >= dayStart(birthWall);
      const ageDays = aged ? (dayStart(e.startWall) - dayStart(birthWall)) / MS_PER_DAY : null;
      const age = !aged ? '' : ageDays === 0 ? 'on day one' : `at ${fmtAgeAt(birthWall, e.startWall)}`;
      const date = fmtDate(e.startWall);
      return {
        id: e.id,
        wall: e.startWall,
        title: title(e) || 'Milestone',
        cat,
        k: iconOf(cat),
        catLabel: cat ? MILESTONE_CATS[cat].label : '',
        age,
        date,
        when: age || date,
        by: e.loggedBy ? e.loggedBy.split('@')[0] : '',
        month: aged ? calendarMonths(birthWall, e.startWall) : null,
        // what the edit modal needs, ISO-encoded (mirrors views.js rawEvent)
        raw: {
          id: e.id, type: e.type, start: wallMsToIso(e.startWall),
          durationMin: e.durationMin, side: e.side || '', amountMl: e.amountMl,
          formulaMl: e.formulaMl, leftoverMl: e.leftoverMl ?? null, notes: e.notes || '',
        },
      };
    });

  // timeline groups, newest first: by month of age when the birth date is
  // known, by calendar month otherwise
  const groups = [];
  for (const it of items) {
    let label;
    if (it.month != null) {
      const y = Math.floor(it.month / 12);
      const rm = it.month % 12;
      label = it.month === 0 ? 'The first month'
        : it.month < 24 ? `${it.month} month${it.month === 1 ? '' : 's'} old`
        : `${y} years${rm ? ` ${rm} month${rm === 1 ? '' : 's'}` : ''} old`;
    } else {
      const d = new Date(it.wall);
      label = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  // the legend doubles as the filter: only categories that have entries
  const counts = [...Object.keys(MILESTONE_CATS), '']
    .map((cat) => ({
      cat, k: iconOf(cat),
      label: cat ? MILESTONE_CATS[cat].short : OTHER.short,
      n: items.filter((i) => i.cat === cat).length,
    }))
    .filter((c) => c.n > 0);

  const ribbon = buildRibbon(items, birthWall, nowWall);
  const strip = ({ wall: _w, month: _m, when: _n, ...rest }) => rest;
  const latest = items[0];
  return {
    total: items.length,
    headline: items.length === 1 ? '1 milestone' : `${items.length} milestones`,
    latest: latest ? `Latest: ${latest.title} · ${agoLabel(latest.wall, nowWall)}` : '',
    ageLabel: birthWall != null ? fmtAgeAt(birthWall, nowWall) + ' old' : '',
    needsBirth: birthWall == null,
    ribbon,
    counts,
    groups: groups.map((g) => ({ label: g.label, items: g.items.map(strip) })),
    cats: Object.entries(MILESTONE_CATS).map(([key, c]) => ({ key, label: c.short })),
    chips: milestoneChips(events, 8),
  };
}
