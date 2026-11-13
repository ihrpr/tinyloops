/**
 * Milestones view: the render-ready /api/milestones payload.
 *
 * A milestone is an ordinary Log row (type 'milestone') whose notes column
 * holds what happened ("First smile"). The Milestones tab draws them as a
 * timeline grouped by the baby's age; every label is computed here so the
 * client only renders.
 */

import { dayStart, isoToWallMs, MS_PER_DAY } from './time.js';
import { TYPES, rawEvent } from './views.js';
import { fmtAgeAt, calendarMonths } from './growth.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const fmtDate = (w) => {
  const d = new Date(w);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Age in whole weeks plus leftover days ("27 weeks 2 days"), the way
 *  health visitors and baby books count; '' before the first full week. */
export function fmtAgeWeeks(birthWall, wall) {
  const days = Math.round((dayStart(wall) - dayStart(birthWall)) / MS_PER_DAY);
  if (days < 7) return '';
  const w = Math.floor(days / 7);
  const d = days % 7;
  return `${w} week${w === 1 ? '' : 's'}` + (d ? ` ${d} day${d === 1 ? '' : 's'}` : '');
}

/**
 * events: the whole log (newest first); settings: the sheet's Settings tab
 * (baby_birth_date is shared with the Growth view and gives each milestone
 * its age — without it the timeline falls back to calendar months).
 */
export function buildMilestones(events, settings, nowWall) {
  const parsedBirth = isoToWallMs(String(settings.baby_birth_date || ''));
  const birthWall = parsedBirth != null && parsedBirth <= nowWall ? parsedBirth : null;

  // timeline groups, newest first: by month of age when the birth date is
  // known, by calendar month otherwise
  const groups = [];
  let total = 0;
  for (const e of events) {
    if (e.type !== 'milestone' || e.startWall == null) continue;
    total++;
    const aged = birthWall != null && dayStart(e.startWall) >= dayStart(birthWall);
    const ageDays = aged ? (dayStart(e.startWall) - dayStart(birthWall)) / MS_PER_DAY : null;
    let label;
    if (aged) {
      const m = calendarMonths(birthWall, e.startWall);
      const y = Math.floor(m / 12);
      const rm = m % 12;
      label = m === 0 ? 'The first month'
        : m < 24 ? `${m} month${m === 1 ? '' : 's'} old`
        : `${y} years${rm ? ` ${rm} month${rm === 1 ? '' : 's'}` : ''} old`;
    } else {
      const d = new Date(e.startWall);
      label = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    const item = {
      id: e.id,
      title: String(e.notes || '').trim() || 'Milestone',
      age: !aged ? '' : ageDays === 0 ? 'on day one' : `at ${fmtAgeAt(birthWall, e.startWall)}`,
      date: fmtDate(e.startWall),
      by: e.loggedBy ? e.loggedBy.split('@')[0] : '',
      raw: rawEvent(e),
    };
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  // the age line: the usual label plus the age in weeks; while the usual
  // label is itself in weeks (2-13 weeks) the precise one replaces it
  const ageNow = birthWall != null ? fmtAgeAt(birthWall, nowWall) : '';
  const weeksNow = birthWall != null ? fmtAgeWeeks(birthWall, nowWall) : '';
  const ageLabel = !ageNow ? ''
    : !weeksNow ? `${ageNow} old`
    : / weeks?$/.test(ageNow) ? `${weeksNow} old`
    : `${ageNow} old · ${weeksNow}`;

  return {
    total,
    headline: total === 1 ? '1 milestone' : `${total} milestones`,
    ageLabel,
    needsBirth: birthWall == null,
    groups,
    // the edit modal can re-type an entry, exactly as on the log view
    types: Object.entries(TYPES).map(([key, t]) => ({ key, label: t.label, timed: t.timed })),
  };
}
