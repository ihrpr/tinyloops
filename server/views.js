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

export const TYPES = {
  feed:   { label: 'Breastfeed',        short: 'Breast',  emoji: '🤱', timed: true },
  bottle: { label: 'Bottle',            short: 'Bottle',  emoji: '🍼', timed: false },
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

function overlapMin(e, fromWall, nowWall) {
  const end = Math.min(e.endWall || nowWall, nowWall);
  const start = Math.max(e.startWall, fromWall);
  return Math.max(0, Math.round((end - start) / MS_PER_MIN));
}

// ---------- shared pieces ----------

export function enabledTypes(settings) {
  const raw = String(settings.enabled_types || '').trim();
  if (!raw) return new Set(ALL_TYPES);
  const set = new Set(raw.split(',').map((s) => s.trim()).filter((k) => TYPES[k]));
  return set.size ? set : new Set(ALL_TYPES);
}

const sideName = (s) => (s === 'L' ? 'left' : s === 'R' ? 'right' : 'both sides');

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
  if (e.side) parts.push(sideName(e.side));
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
    },
    sideHint,
    open,
    summary: buildSummary(events, settings, nowWall),
    list,
  };
}

// ---------- day summary ----------

function buildSummary(events, settings, nowWall) {
  const dayStartMs = dayStart(nowWall);
  const isTimed = (e) => (TYPES[e.type] || {}).timed;
  const isToday = (e) => e.startWall >= dayStartMs ||
    (e.endWall && e.endWall >= dayStartMs) || (isTimed(e) && !e.endWall);
  const todayOf = (t) => events.filter((e) => e.type === t && isToday(e));
  const allOf = (t) => events.filter((e) => e.type === t); // newest first
  const openFeed = events.some((e) => e.type === 'feed' && !e.endWall);

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

  const rows = [];
  const pushRow = (emoji, label, ago, parts) => {
    const value = parts.filter(Boolean).join(' · ');
    if (!value && !ago) return;
    rows.push({ kind: 'row', emoji, label, ago, value });
  };
  const pushSub = (label, value) => rows.push({ kind: 'sub', label, value });

  const feeds = todayOf('feed');
  const bottles = todayOf('bottle');

  // when were breasts last emptied (breastfeed or pump, whichever is later)
  if (en.has('feed') || en.has('pump')) {
    const lastEmpty = events.find((e) => e.type === 'feed' || e.type === 'pump');
    pushRow('🤱', 'Breasts emptied', '',
      [openFeed ? 'feeding now'
        : lastEmpty ? agoDur(lastEmpty.startWall, nowWall) + (lastEmpty.type === 'pump' ? ' (pump)' : ' (feed)')
        : '—']);
  }

  // when the baby last ate (breastfeed or bottle, whichever is later)
  if (en.has('feed') || en.has('bottle')) {
    const lastAte = events.find((e) => e.type === 'feed' || e.type === 'bottle');
    pushRow('👶', 'Last ate', '',
      [openFeed ? 'feeding now'
        : lastAte ? agoDur(lastAte.startWall, nowWall) + (lastAte.type === 'bottle' ? ' (bottle)' : ' (breast)')
        : '—']);
  }

  // total milk taken today, breastfeeds counted at the assumed amount
  const bmMl = bottles.reduce((a, e) => a + (e.amountMl || 0), 0);
  const formulaMl = bottles.reduce((a, e) => a + (e.formulaMl || 0), 0);
  const breastfedMl = feeds.length * assumedMl;
  const totalMl = bmMl + formulaMl + breastfedMl;
  pushRow('🍽️', 'Milk today', '', [totalMl ? `≈${totalMl}ml` : '']);
  if (feeds.length) pushSub('Breastfed', `${feeds.length}× · ≈${breastfedMl}ml`);
  if (bmMl) pushSub('Bottle milk', `${bmMl}ml`);
  if (formulaMl) pushSub('Formula', `${formulaMl}ml`);

  const sleeps = todayOf('sleep');
  if (en.has('sleep') || sleeps.length) {
    const sleepsAll = allOf('sleep');
    const sleepingNow = sleepsAll.some((e) => !e.endWall);
    const lastWake = sleepsAll.find((e) => e.endWall);
    const sleepMin = sleeps.reduce((a, e) => a + overlapMin(e, dayStartMs, nowWall), 0);
    pushRow('😴', 'Sleep',
      sleepingNow ? 'sleeping now'
        : lastWake ? 'awake for ' + fmtMin(Math.max(0, Math.floor((nowWall - lastWake.endWall) / MS_PER_MIN))) : '',
      [sleepMin ? fmtMin(sleepMin) : '']);
  }

  const plays = todayOf('play');
  if (en.has('play') || plays.length) {
    const lastPlay = allOf('play')[0];
    const playMin = plays.reduce((a, e) => a + overlapMin(e, dayStartMs, nowWall), 0);
    pushRow('🧸', 'Play',
      lastPlay ? (!lastPlay.endWall ? 'playing now' : agoDur(lastPlay.startWall, nowWall)) : '',
      [playMin ? fmtMin(playMin) : '']);
  }

  const pumps = todayOf('pump');
  if (en.has('pump') || pumps.length) {
    const lastPump = allOf('pump')[0];
    const pumpMl = pumps.reduce((a, e) => a + (e.amountMl || 0), 0);
    pushRow('🥛', 'Pumped',
      lastPump ? agoDur(lastPump.startWall, nowWall) : '',
      [pumps.length ? `${pumps.length}×` : '', pumpMl ? `${pumpMl}ml` : '']);
  }

  const wet = todayOf('wet').length;
  const dirty = todayOf('dirty').length;
  if (en.has('wet') || en.has('dirty') || wet || dirty) {
    const lastNappy = events.find((e) => e.type === 'wet' || e.type === 'dirty');
    pushRow('💧💩', 'Nappies',
      lastNappy ? agoDur(lastNappy.startWall, nowWall) : '',
      [(wet || dirty) ? `${wet} wet · ${dirty} dirty` : '']);
  }

  return {
    empty: false,
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

  return {
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
