/**
 * Builds the render-ready payload for each view (home, stats, one day).
 * Pure functions: (events, settings, nowWall) → JSON the client renders
 * verbatim, computing nothing itself.
 *
 * Every time here is a wall ms (see time.js); `nowWall` comes from the
 * phone's clock via the request, so "today", elapsed times and day
 * boundaries mean exactly what they meant when this math ran on-device.
 */

import { dayStart, wallMsToIso, wallMsToDate, MS_PER_DAY, MS_PER_MIN } from './time.js';
import { foodTokens, foodChips } from './foods.js';

export const TYPES = {
  feed:   { label: 'Breastfeed',        short: 'Breast',  emoji: '🤱', timed: true },
  bottle: { label: 'Bottle',            short: 'Bottle',  emoji: '🍼', timed: false },
  solid:  { label: 'Solids',            short: 'Solids',  emoji: '🥣', timed: false },
  sleep:  { label: 'Sleep',             short: 'Sleep',   emoji: '😴', timed: true },
  play:   { label: 'Play / tummy time', short: 'Play',    emoji: '🧸', timed: true },
  pump:   { label: 'Pump',              short: 'Pump',    emoji: '🥛', timed: false },
  wet:    { label: 'Wet nappy',         short: 'Wet',     emoji: '💧', timed: false },
  dirty:  { label: 'Dirty nappy',       short: 'Dirty',   emoji: '💩', timed: false },
};
const ALL_TYPES = Object.keys(TYPES);

// ---------- formatting (en labels; wall ms in, strings out) ----------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const d = (wallMs) => new Date(wallMs);

function fmtMin(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const pad = (n) => String(n).padStart(2, '0');
// null start_time can only come from a human blanking the cell in the sheet
const fmtTime = (w) => (w == null ? '—' : `${pad(d(w).getUTCHours())}:${pad(d(w).getUTCMinutes())}`);

function fmtDay(w, nowWall) {
  const today = dayStart(nowWall);
  if (w >= today) return 'Today';
  if (w >= today - MS_PER_DAY) return 'Yesterday';
  return `${DAYS[d(w).getUTCDay()]} ${d(w).getUTCDate()} ${MONTHS[d(w).getUTCMonth()]}`;
}

const agoDur = (w, nowWall) => {
  const m = Math.floor((nowWall - w) / MS_PER_MIN);
  return m < 1 ? 'just now' : `${fmtMin(m)} ago`;
};

/** Minutes of an event elapsed so far (open events count to now). A blanked
 *  start cell (hand-edited sheet) counts as 0, not as "since 1899". */
const elapsedMin = (e, nowWall) => (e.startWall == null ? 0
  : Math.max(0, Math.round(((e.endWall || nowWall) - e.startWall) / MS_PER_MIN)));

// ---------- shared pieces ----------

export function enabledTypes(settings) {
  const raw = String(settings.enabled_types || '').trim();
  if (!raw) return new Set(ALL_TYPES);
  const set = new Set(raw.split(',').map((s) => s.trim()).filter((k) => TYPES[k]));
  return set.size ? set : new Set(ALL_TYPES);
}

const sideName = (s) => (s === 'L' ? 'left' : s === 'R' ? 'right' : 'both sides');

/** Sleep segments overlapping [start, end), as minutes from `start`, clipped
 *  to the window and to now (open sleeps run to now). Sorted by start. Feeds
 *  the day-strip widget on the home screen and the rhythm view on stats.
 *  `cat` narrows to one category: 'night' (side === 'night') or 'nap' (the
 *  default — any sleep not marked night). */
function sleepSegments(events, start, end, nowWall, cat) {
  const segs = [];
  for (const e of events) {
    if (e.type !== 'sleep' || e.startWall == null) continue;
    if (cat === 'night' && e.side !== 'night') continue;
    if (cat === 'nap' && e.side === 'night') continue;
    const s = Math.max(e.startWall, start);
    const en = Math.min(e.endWall || nowWall, end);
    if (en <= s) continue;
    segs.push({ a: Math.round((s - start) / MS_PER_MIN),
      b: Math.round((en - start) / MS_PER_MIN),
      // the flag lets the bands paint night sleep in its own colour
      ...(e.side === 'night' && { night: true }) });
  }
  return segs.sort((x, y) => x.a - y.a);
}

/** Start minutes-of-day of feeds (breast + bottle) inside [start, end). */
function feedMinutes(events, start, end) {
  return events
    .filter((e) => (e.type === 'feed' || e.type === 'bottle') &&
      e.startWall != null && e.startWall >= start && e.startWall < end)
    .map((e) => Math.round((e.startWall - start) / MS_PER_MIN))
    .sort((x, y) => x - y);
}

/** The drawable 24h shape of one day: sleep spans + feed-dot minutes. */
function dayShape(events, s, nowWall) {
  return {
    spans: sleepSegments(events, s, s + MS_PER_DAY, nowWall),
    feeds: feedMinutes(events, s, s + MS_PER_DAY),
  };
}

// For solids the side column stores how much was eaten (a shared sheet is a
// readable contract — 'taste'/'some'/'lots' make sense to a human in a cell).
export const EATEN = { taste: 'just a taste', some: 'ate some', lots: 'ate lots' };

// Free-text fields (notes, the email local-part of loggedBy) travel as raw
// data; the client HTML-escapes at its single render boundary. Escaping here
// too would double-escape (a note "a & b" would display as "a &amp; b"), so
// the server deliberately does not escape display strings.

/** The raw fields the edit modal needs, ISO-encoded. */
function rawEvent(e) {
  return {
    id: e.id,
    type: e.type,
    start: e.startWall != null ? wallMsToIso(e.startWall) : '',
    durationMin: e.durationMin,
    side: e.side || '',
    amountMl: e.amountMl,
    formulaMl: e.formulaMl,
    notes: e.notes || '',
  };
}

function eventDetails(e) {
  const parts = [];
  if (e.type === 'solid') {
    // notes already carry the food, so only the eaten amount is added here
    if (EATEN[e.side]) parts.push(EATEN[e.side]);
  } else if (e.type === 'sleep') {
    // naps are the unmarked default — only 'night' is worth a word
    if (e.side === 'night') parts.push('night');
  } else if (e.side) parts.push(sideName(e.side));
  if (e.type === 'bottle') {
    if (e.amountMl) parts.push(`${e.amountMl}ml milk`);
    if (e.formulaMl) parts.push(`${e.formulaMl}ml formula`);
  } else if (e.amountMl) {
    parts.push(`${e.amountMl}ml`);
  }
  if (e.notes) parts.push(e.notes);
  if (e.loggedBy) parts.push('by ' + e.loggedBy.split('@')[0]);
  return parts.join(' · ');
}

// a running timer this old was probably just forgotten — nudge to fix it
const STALE_MIN = { feed: 120, play: 180, sleep: 840 };

// ---------- the home payload (log tab: form meta, open timers, summary, list) ----------

export function buildHome(events, settings, nowWall) {
  const en = enabledTypes(settings);
  const isTimed = (e) => (TYPES[e.type] || {}).timed;
  const nw = d(nowWall);
  const topDate = `${DAYS_LONG[nw.getUTCDay()]} ${nw.getUTCDate()} ${MONTHS_LONG[nw.getUTCMonth()]}`;

  // form metadata: the type grid and the side suggestion
  const types = Object.entries(TYPES).map(([key, t]) => ({
    key, label: t.label, short: t.short, emoji: t.emoji, timed: t.timed,
    enabled: en.has(key),
  }));
  let sideHint = null;
  const lastSide = events.find((e) => e.type === 'feed' && e.side);
  if (!lastSide) {
    sideHint = { text: 'Which side?', suggest: '' };
  } else {
    const suggest = lastSide.side === 'L' ? 'R' : lastSide.side === 'R' ? 'L' : '';
    sideHint = {
      text: `Last time: ${sideName(lastSide.side)} · ${agoDur(lastSide.startWall, nowWall)}` +
        (suggest ? ` — try ${sideName(suggest)}` : ''),
      suggest,
    };
  }

  // open timers
  const open = events
    .filter((e) => isTimed(e) && !e.endWall)
    .map((e) => {
      const min = elapsedMin(e, nowWall);
      const stale = min > (STALE_MIN[e.type] || 180);
      const t = TYPES[e.type] || { label: e.type, emoji: '❓' };
      return {
        id: e.id, type: e.type, emoji: t.emoji,
        label: t.label + (e.side ? ' · ' + e.side : ''),
        sub: stale ? `running ${fmtMin(min)} — forgot to stop? Tap to fix`
          : `${fmtTime(e.startWall)} · tap to edit`,
        stale, elapsed: fmtMin(min), raw: rawEvent(e),
      };
    });

  // today & yesterday list, grouped by day label
  const cutoff = dayStart(nowWall) - MS_PER_DAY;
  const recent = events.filter((e) => e.startWall != null &&
    (e.startWall >= cutoff || (e.endWall && e.endWall >= cutoff) || (isTimed(e) && !e.endWall)));
  const list = [];
  for (const e of recent) {
    const day = fmtDay(e.startWall, nowWall);
    if (!list.length || list[list.length - 1].day !== day) list.push({ day, entries: [] });
    const t = TYPES[e.type] || { label: e.type, emoji: '❓', timed: false };
    const running = t.timed && !e.endWall;
    list[list.length - 1].entries.push({
      id: e.id, type: e.type, emoji: t.emoji, label: t.label,
      details: eventDetails(e),
      time: fmtTime(e.startWall),
      dur: running ? fmtMin(elapsedMin(e, nowWall)) + '…'
        : e.durationMin != null ? fmtMin(e.durationMin) : '',
      raw: rawEvent(e),
    });
  }

  return {
    topDate,
    types,
    settings: {
      breastfeedMl: Number(settings.breastfeed_ml) || 60,
      enabledTypes: ALL_TYPES.filter((k) => en.has(k)),
      // minutes-of-day; the client preselects Night for sleeps started inside
      nightStartMin: nightWindow(settings).startMin,
      nightEndMin: nightWindow(settings).endMin,
    },
    sideHint,
    solidFoods: en.has('solid') ? foodChips(events) : [],
    open,
    summary: buildSummary(events, settings, nowWall),
    list,
  };
}

// ---------- day summary ----------

/**
 * The summary rows for one day [s, s+DAY) — the SAME layout for every day,
 * so paging back reads exactly like today. `isToday` adds what only makes
 * sense in the present: the recency rows (breasts emptied, last ate), the
 * ago-strings, and open events counting toward the day.
 */
function summaryRows(events, s, en, assumedMl, nowWall, isToday) {
  const dayEnd = s + MS_PER_DAY;
  const isTimed = (e) => (TYPES[e.type] || {}).timed;
  const inDay = (e) => e.startWall != null && ((e.startWall >= s && e.startWall < dayEnd) ||
    (isToday && ((e.endWall && e.endWall >= s) || (isTimed(e) && !e.endWall))));
  const of = (t) => events.filter((e) => e.type === t && inDay(e));
  const allOf = (t) => events.filter((e) => e.type === t); // newest first
  const openFeed = isToday && events.some((e) => e.type === 'feed' && !e.endWall);
  // minutes of a timed event inside this day (open events run to now)
  const overlap = (e) => (e.startWall == null ? 0 : Math.max(0, Math.round(
    (Math.min(e.endWall || nowWall, dayEnd, nowWall) - Math.max(e.startWall, s)) / MS_PER_MIN)));

  const rows = [];
  // `k` is the icon key the client maps to its SVG set; emoji stays as a
  // fallback for anything that still renders text.
  const pushRow = (k, emoji, label, ago, parts) => {
    const value = parts.filter(Boolean).join(' · ');
    if (!value && !ago) return;
    rows.push({ kind: 'row', k, emoji, label, ago, value });
  };
  const pushSub = (label, value) => rows.push({ kind: 'sub', label, value });

  // milk taken that day, breastfeeds counted at the assumed amount
  // (≈ only when they contribute; a bottles-only day is exact). Today's ago
  // is when the baby last ate — breastfeed or bottle, whichever is later.
  const feeds = of('feed');
  const bottles = of('bottle');
  const bmMl = bottles.reduce((a, e) => a + (e.amountMl || 0), 0);
  const formulaMl = bottles.reduce((a, e) => a + (e.formulaMl || 0), 0);
  const breastfedMl = feeds.length * assumedMl;
  const totalMl = bmMl + formulaMl + breastfedMl;
  const lastAte = isToday ? events.find((e) => e.type === 'feed' || e.type === 'bottle') : null;
  pushRow('milk', '🍽️', isToday ? 'Milk today' : 'Milk',
    openFeed ? 'feeding now'
      : lastAte ? agoDur(lastAte.startWall, nowWall) + (lastAte.type === 'bottle' ? ' (bottle)' : ' (breast)')
      : '',
    [totalMl ? `${breastfedMl ? '≈' : ''}${totalMl}ml` : '']);
  if (feeds.length) pushSub('Breastfed', `${feeds.length}× · ≈${breastfedMl}ml`);
  if (bmMl) pushSub('Bottle milk', `${bmMl}ml`);
  if (formulaMl) pushSub('Formula', `${formulaMl}ml`);

  const solids = of('solid');
  if (en.has('solid') || solids.length) {
    const lastSolid = allOf('solid')[0];
    // dedupe case-insensitively, keeping the first-typed casing
    const seen = new Set();
    const foodsThatDay = solids.flatMap((e) => foodTokens(e)).filter((t) => {
      if (seen.has(t.toLowerCase())) return false;
      seen.add(t.toLowerCase());
      return true;
    });
    pushRow('solid', '🥣', 'Solids',
      isToday && lastSolid ? agoDur(lastSolid.startWall, nowWall) : '',
      [solids.length ? `${solids.length}×` : '', foodsThatDay.join(', ')]);
  }

  // sleep splits into two categories. Naps (the unmarked default) belong to
  // the calendar day. Night-marked sleep belongs to the MORNING it ends on:
  // it's counted over a noon-to-noon window, so "Night" on day D is the
  // whole night that led into D — including its pre-midnight part from the
  // previous day. Tonight's sleep, still running at bedtime, counts toward
  // tomorrow. Subs appear only once night-marking is in use.
  const napSegs = sleepSegments(events, s, dayEnd, nowWall, 'nap');
  const napMin = napSegs.reduce((a, g) => a + (g.b - g.a), 0);
  const nightMin = sleepSegments(events,
    s - MS_PER_DAY / 2, s + MS_PER_DAY / 2, nowWall, 'night')
    .reduce((a, g) => a + (g.b - g.a), 0);
  const sleepMin = napMin + nightMin;
  if (en.has('sleep') || sleepMin) {
    const sleepsAll = allOf('sleep');
    const sleepingNow = sleepsAll.some((e) => !e.endWall);
    const lastWake = sleepsAll.find((e) => e.endWall);
    pushRow('sleep', '😴', 'Sleep',
      !isToday ? ''
        : sleepingNow ? 'sleeping now'
        : lastWake ? 'awake for ' + fmtMin(Math.max(0, Math.floor((nowWall - lastWake.endWall) / MS_PER_MIN))) : '',
      [sleepMin ? fmtMin(sleepMin) : '']);
    if (nightMin) {
      pushSub('Night', fmtMin(nightMin));
      if (napMin) pushSub('Naps', `${napSegs.length}× · ${fmtMin(napMin)}`);
    }
  }

  const playMin = events.filter((e) => e.type === 'play')
    .reduce((a, e) => a + overlap(e), 0);
  if (en.has('play') || playMin) {
    const lastPlay = allOf('play')[0];
    pushRow('play', '🧸', 'Play',
      isToday && lastPlay ? (!lastPlay.endWall ? 'playing now' : agoDur(lastPlay.startWall, nowWall)) : '',
      [playMin ? fmtMin(playMin) : '']);
  }

  const pumps = of('pump');
  if (en.has('pump') || pumps.length) {
    const lastPump = allOf('pump')[0];
    const pumpMl = pumps.reduce((a, e) => a + (e.amountMl || 0), 0);
    pushRow('pump', '🥛', 'Pumped',
      isToday && lastPump ? agoDur(lastPump.startWall, nowWall) : '',
      [pumps.length ? `${pumps.length}×` : '', pumpMl ? `${pumpMl}ml` : '']);
  }

  const wet = of('wet').length;
  const dirty = of('dirty').length;
  if (en.has('wet') || en.has('dirty') || wet || dirty) {
    const lastNappy = events.find((e) => e.type === 'wet' || e.type === 'dirty');
    pushRow('nappies', '💧💩', 'Nappies',
      isToday && lastNappy ? agoDur(lastNappy.startWall, nowWall) : '',
      [(wet || dirty) ? `${wet} wet · ${dirty} dirty` : '']);
  }

  return rows;
}

function buildSummary(events, settings, nowWall) {
  const dayStartMs = dayStart(nowWall);
  const assumedMl = Number(settings.breastfeed_ml) || 60;
  const en = enabledTypes(settings);

  if (!events.length) {
    return {
      empty: true,
      note: 'Nothing here yet. Pick an activity above and tap the green button — ' +
        'your day builds up here, and every entry can be edited later by tapping it in the list.',
      rows: [],
    };
  }

  const rows = summaryRows(events, dayStartMs, en, assumedMl, nowWall, true);

  // the day strip drawn above the rows, pageable back through the week: one
  // payload, no extra sheet reads. Past days carry their own rows (same
  // layout as today, minus the now-statuses); today's rows are the top-level
  // `rows` so they aren't shipped twice. Omitted when the week is empty.
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const s = dayStartMs - i * MS_PER_DAY;
    days.push({
      ...dayShape(events, s, nowWall),
      date: wallMsToDate(s),
      name: fmtDay(s, nowWall),
      today: i === 0,
      ...(i > 0 && { rows: summaryRows(events, s, en, assumedMl, nowWall, false) }),
    });
  }

  return {
    empty: false,
    days: days.some((day) => day.spans.length || day.feeds.length || day.rows?.length)
      ? days : null,
    nowMin: Math.round((nowWall - dayStartMs) / MS_PER_MIN),
    rows,
    note: en.has('feed') ? `1 breastfeed ≈ ${assumedMl}ml — tap to change` : null,
  };
}

// ---------- stats (charts + table over an arbitrary date range) ----------

export const MAX_STATS_DAYS = 92;

/**
 * fromWall/toWall are day-start wall ms, inclusive. The caller validates
 * the range; this builds per-day aggregates plus everything the charts
 * and table print.
 */
export function buildStats(events, settings, fromWall, toWall) {
  const assumedMl = Number(settings.breastfeed_ml) || 60;
  const n = Math.round((toWall - fromWall) / MS_PER_DAY) + 1;

  const days = [];
  for (let i = 0; i < n; i++) {
    const start = fromWall + i * MS_PER_DAY;
    const end = start + MS_PER_DAY;
    const dd = d(start);
    days.push({
      date: wallMsToDate(start),
      start, end,
      label: n <= 7 ? DAYS[dd.getUTCDay()] : String(dd.getUTCDate()),
      full: `${DAYS[dd.getUTCDay()]} ${dd.getUTCDate()} ${MONTHS[dd.getUTCMonth()]}`,
      brief: `${DAYS[dd.getUTCDay()]} ${dd.getUTCDate()}`,
    });
  }
  days.forEach((day) => {
    const started = (t) => events.filter((e) =>
      e.type === t && e.startWall >= day.start && e.startWall < day.end);
    const feeds = started('feed');
    const bottles = started('bottle');
    day.bfCount = feeds.length;
    day.feedCount = feeds.length + bottles.length;
    day.bfMl = feeds.length * assumedMl;
    day.bmMl = bottles.reduce((a, e) => a + (e.amountMl || 0), 0);
    day.fMl = bottles.reduce((a, e) => a + (e.formulaMl || 0), 0);
    day.totalMl = day.bfMl + day.bmMl + day.fMl;
    const pumps = started('pump');
    day.pumpCount = pumps.length;
    day.pumpMl = pumps.reduce((a, e) => a + (e.amountMl || 0), 0);
    day.milkDetail = `${day.full}: ≈${day.totalMl}ml — breastfed ${day.bfCount}× ≈${day.bfMl}ml, ` +
      `bottle milk ${day.bmMl}ml, formula ${day.fMl}ml`;
    day.pumpDetail = `${day.full}: ${day.pumpMl}ml pumped` +
      (day.pumpCount ? ` (${day.pumpCount}×)` : '');
    delete day.start; delete day.end;
  });

  // least-squares fit over daily pump totals (days with no pumping count as 0)
  const meanX = (n - 1) / 2;
  const meanY = days.reduce((a, day) => a + day.pumpMl, 0) / n;
  let num = 0, den = 0;
  days.forEach((day, i) => { num += (i - meanX) * (day.pumpMl - meanY); den += (i - meanX) ** 2; });
  const slope = den ? num / den : 0; // ml per day
  const pumpMax = Math.max(...days.map((day) => day.pumpMl), 1);
  const yAt = (i) => Math.min(pumpMax, Math.max(0, meanY + slope * (i - meanX)));
  const weekly = Math.round(slope * 7);
  const anyPump = days.some((day) => day.pumpMl > 0);

  // label crowding control for arbitrary spans
  const labelStep = n <= 7 ? 1 : n <= 16 ? 2 : n <= 45 ? 5 : 10;

  // First-tastes diary — deliberately ALL-TIME, not range-bound: "has she
  // had egg before?" needs the full history. Grouped case-insensitively on
  // the comma-separated food tokens; first-typed casing wins the display.
  const foodMap = new Map();
  for (const e of events.slice().reverse()) { // oldest first
    if (e.type !== 'solid' || e.startWall == null) continue;
    for (const t of foodTokens(e)) {
      const f = foodMap.get(t.toLowerCase());
      if (f) f.count += 1;
      else foodMap.set(t.toLowerCase(), { food: t.slice(0, 60), firstWall: e.startWall, count: 1 });
    }
  }
  const foods = [...foodMap.values()]
    .sort((a, b) => b.firstWall - a.firstWall)
    .slice(0, 200)
    .map((f) => ({ food: f.food, first: fmtDay(f.firstWall, toWall), count: f.count }));

  return {
    foods,
    from: days[0].date,
    to: days[n - 1].date,
    days,
    labelStep,
    showVals: n <= 7,
    milk: {
      max: Math.max(...days.map((day) => day.totalMl), 1),
      any: days.some((day) => day.totalMl > 0),
    },
    pump: {
      max: pumpMax,
      any: anyPump,
      note: anyPump
        ? `avg ${Math.round(meanY)}ml/day · trend ${weekly > 0 ? '↗ +' : weekly < 0 ? '↘ ' : '→ '}` +
          `${weekly ? weekly + 'ml/week' : 'steady'}`
        : 'No pumping logged in this range',
      trend: { y0: yAt(0), y1: yAt(n - 1) },
    },
  };
}

// ---------- rhythm (today's loop, stacked week bands, trend tiles) ----------

const parseHm = (v, dflt) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return dflt;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < 1440 && Number(m[2]) < 60 ? min : dflt;
};

/** The family's configured night window as minutes-of-day; defaults to
 *  19:30 → 07:30. Drives the Night default when logging a sleep and bounds
 *  the night-stretch / wake-window stats. */
export function nightWindow(settings) {
  return {
    startMin: parseHm(settings.night_start, 19 * 60 + 30),
    endMin: parseHm(settings.night_end, 7 * 60 + 30),
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Averages over the 7 complete days starting at w0 (w0 = a day start).
 *  Days before the family's first-ever entry don't dilute the averages. */
function rhythmWindow(events, w0, firstDay, nowWall, nw) {
  const covered = [];
  for (let i = 0; i < 7; i++) {
    const s = w0 + i * MS_PER_DAY;
    if (s >= firstDay) covered.push(s);
  }
  if (!covered.length) return null;

  let sleepMin = 0, feedCount = 0;
  const stretches = []; // longest unbroken night sleep, one per night with data
  const wakes = [];     // daytime gaps between sleeps
  for (const s of covered) {
    const segs = sleepSegments(events, s, s + MS_PER_DAY, nowWall);
    sleepMin += segs.reduce((a, g) => a + (g.b - g.a), 0);
    feedCount += feedMinutes(events, s, s + MS_PER_DAY).length;

    // the night that *ends* this morning, over the configured night window
    // (default yesterday 19:30 → today 07:30)
    const night = sleepSegments(events,
      s - MS_PER_DAY + nw.startMin * MS_PER_MIN,
      s + nw.endMin * MS_PER_MIN, nowWall);
    const longest = Math.max(0, ...night.map((g) => g.b - g.a));
    if (longest > 0) stretches.push(longest);

    // wake windows: gaps between consecutive sleeps, entirely inside the
    // configured daytime; 10min–6h keeps double-logs and missing-data holes
    // out of the median
    for (let i = 1; i < segs.length; i++) {
      const gap = segs[i].a - segs[i - 1].b;
      if (gap >= 10 && gap <= 360 &&
        segs[i - 1].b >= nw.endMin && segs[i].a <= nw.startMin) {
        wakes.push(gap);
      }
    }
  }
  return {
    sleepPerDay: Math.round(sleepMin / covered.length),
    feedsPerDay: feedCount / covered.length,
    nightStretch: stretches.length
      ? Math.round(stretches.reduce((a, x) => a + x, 0) / stretches.length) : null,
    wakeWindow: median(wakes),
  };
}

/** '▲ 35m vs last week' — deltas under ~5min (or 0.3 feeds) read as noise. */
function minDelta(cur, prev) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 5) return '≈ same as last week';
  return `${diff > 0 ? '▲' : '▼'} ${fmtMin(Math.abs(diff))} vs last week`;
}

const fmtPerDay = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');

/**
 * The rhythm payload for stats: every day of the PICKED range [fromWall,
 * toWall] as a stacked band, plus week-over-week trend tiles. All
 * minutes-of-day and all clipping happen here — the client only draws.
 * Tiles stay anchored to the last 7 COMPLETE days vs the 7 before (their
 * deltas literally say "vs last week"), so only the bands follow the picker.
 */
export function buildRhythm(events, settings, nowWall, fromWall, toWall) {
  const today = dayStart(nowWall);
  const nowMin = Math.round((nowWall - today) / MS_PER_MIN);
  const n = Math.round((toWall - fromWall) / MS_PER_DAY) + 1;

  const days = [];
  for (let i = 0; i < n; i++) {
    const s = fromWall + i * MS_PER_DAY;
    const dd = d(s);
    days.push({
      date: wallMsToDate(s),
      name: s === today ? 'Today'
        : n <= 7 ? DAYS[dd.getUTCDay()]
        : `${dd.getUTCDate()}/${dd.getUTCMonth() + 1}`,
      spans: sleepSegments(events, s, s + MS_PER_DAY, nowWall),
      feeds: feedMinutes(events, s, s + MS_PER_DAY),
      today: s === today,
    });
  }
  // hide the bands when the picked range holds nothing to draw
  const any = days.some((day) => day.spans.length || day.feeds.length);
  if (!any) return { any: false };
  // label crowding control, same steps as the milk chart
  const labelStep = n <= 14 ? 1 : n <= 31 ? 2 : n <= 45 ? 5 : 10;

  let firstWall = Infinity;
  for (const e of events) if (e.startWall != null && e.startWall < firstWall) firstWall = e.startWall;
  const firstDay = firstWall === Infinity ? today : dayStart(firstWall);
  const nw = nightWindow(settings);
  const cur = rhythmWindow(events, today - 7 * MS_PER_DAY, firstDay, nowWall, nw);
  const prev = rhythmWindow(events, today - 14 * MS_PER_DAY, firstDay, nowWall, nw);

  const tiles = [];
  if (cur) {
    tiles.push({ label: 'Sleep per day', value: fmtMin(cur.sleepPerDay),
      delta: minDelta(cur.sleepPerDay, prev?.sleepPerDay) });
    if (cur.nightStretch != null) {
      tiles.push({ label: 'Longest night stretch', value: fmtMin(cur.nightStretch),
        delta: minDelta(cur.nightStretch, prev?.nightStretch) });
    }
    const fDiff = prev ? cur.feedsPerDay - prev.feedsPerDay : null;
    tiles.push({ label: 'Feeds per day', value: fmtPerDay(cur.feedsPerDay),
      delta: fDiff == null ? null : Math.abs(fDiff) < 0.3 ? '≈ same as last week'
        : `${fDiff > 0 ? '▲' : '▼'} ${fmtPerDay(Math.abs(fDiff))} vs last week` });
    if (cur.wakeWindow != null) {
      tiles.push({ label: 'Typical wake window', value: fmtMin(cur.wakeWindow),
        delta: minDelta(cur.wakeWindow, prev?.wakeWindow) });
    }
  }

  return { any: true, nowMin, days, labelStep, tiles };
}

/** One day's entries (the /api/days/:date endpoint). */
export function buildDay(events, date, nowWall) {
  const start = date;
  const end = start + MS_PER_DAY;
  const dd = d(start);
  const entries = events
    .filter((e) => e.startWall >= start && e.startWall < end)
    .map((e) => {
      const t = TYPES[e.type] || { label: e.type, emoji: '❓', timed: false };
      const running = t.timed && !e.endWall;
      return {
        id: e.id, type: e.type, emoji: t.emoji, label: t.label,
        details: eventDetails(e),
        time: fmtTime(e.startWall),
        dur: running ? fmtMin(elapsedMin(e, nowWall)) + '…'
          : e.durationMin != null ? fmtMin(e.durationMin) : '',
        raw: rawEvent(e),
      };
    });
  return {
    date: wallMsToDate(start),
    label: `${DAYS[dd.getUTCDay()]} ${dd.getUTCDate()} ${MONTHS[dd.getUTCMonth()]}`,
    entries,
  };
}
