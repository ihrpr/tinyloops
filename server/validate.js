/**
 * Pure input validation for event payloads. Kept separate from the router so
 * it can be unit-tested without the Worker runtime, and so every bound that
 * protects the shared sheet lives in one place.
 */

import { TYPES } from './views.js';
import { isoToWallMs } from './time.js';
import { UserFacingError } from './errors.js';

// Upper bounds keep a fat-fingered or malicious value from corrupting the
// shared sheet and its totals (a duration of 1e15 min → a garbage serial).
export const MAX_ML = 10000;          // ml per feed/pump entry
export const MAX_DURATION_MIN = 10080; // one week
export const MAX_NOTES = 500;

/** Thrown on invalid input; message is safe to show the user. */
export class ValidationError extends UserFacingError {}

/** A non-negative number within [0, max], rounded to an integer, or null. */
export function clampInt(v, max) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n);
}

/** Neutralize a leading formula trigger so the text can never be evaluated
 *  as a formula on CSV/spreadsheet export (RAW writes already keep it inert
 *  in Sheets itself; this closes the downstream-export path too). */
export function safeText(s, max = MAX_NOTES) {
  const t = String(s || '').slice(0, max);
  return /^[=+\-@|\t\r]/.test(t) ? "'" + t : t;
}

/** Validate a partner email for sheet sharing. Loose shape check only —
 *  Google is the real authority on whether the address exists. */
export function shareEmail(v) {
  const email = String(v || '').trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Please enter your partner's email address.");
  }
  return email;
}

/** Validate a caregiver's display name (goes into the sheet's "added by"
 *  column, so it passes through safeText like any other written text). */
export function caregiverName(v) {
  const name = safeText(String(v ?? '').trim().replace(/\s+/g, ' '), 40);
  if (!name) throw new ValidationError('Please enter your name.');
  return name;
}

// Growth bounds: generous enough for any real 0–2y measurement (and premies),
// tight enough that a value in the wrong unit (grams, metres) is caught.
export const WEIGHT_KG = { min: 0.2, max: 40 };
export const HEIGHT_CM = { min: 20, max: 140 };

const numIn = (v, { min, max }, dp) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return undefined; // out of range
  return Math.round(n * 10 ** dp) / 10 ** dp;
};

/** Validate a growth measurement. `nowWall` is the phone's clock. */
export function growthParams(body, nowWall) {
  const dateWall = isoToWallMs(String(body.date || '').slice(0, 10));
  if (dateWall == null) throw new ValidationError('Please set the measurement date.');
  if (dateWall > nowWall) throw new ValidationError("The measurement date can't be in the future.");
  const weightKg = numIn(body.weightKg, WEIGHT_KG, 3);
  if (weightKg === undefined) {
    throw new ValidationError('That weight looks off — enter kilograms, e.g. 4.25.');
  }
  const heightCm = numIn(body.heightCm, HEIGHT_CM, 1);
  if (heightCm === undefined) {
    throw new ValidationError('That height looks off — enter centimetres, e.g. 58.5.');
  }
  if (weightKg == null && heightCm == null) {
    throw new ValidationError('Enter a weight, a height, or both.');
  }
  return { dateWall, weightKg, heightCm, notes: safeText(body.notes) };
}

/** Validate the baby profile (birth date + sex) for percentile curves. */
export function profileParams(body, nowWall) {
  const birthDate = String(body.birthDate || '').slice(0, 10);
  const birthWall = isoToWallMs(birthDate);
  if (birthWall == null || birthWall > nowWall) {
    throw new ValidationError("Please enter your baby's birth date.");
  }
  if (nowWall - birthWall > 6 * 366 * 86400000) {
    throw new ValidationError('That birth date looks wrong — tinyloops charts cover ages 0–2.');
  }
  const sex = ['girl', 'boy'].includes(body.sex) ? body.sex : null;
  if (!sex) throw new ValidationError('Pick girl or boy — the WHO curves differ.');
  return { birthDate, sex };
}

/**
 * Validate + canonicalize the target-day plan from the settings form.
 * Returns { targetNaps, targetFeeds } as stored in the sheet — readable text
 * ("08:30-10:00, 11:45-13:15" / "07:00, 10:00"), zero-padded and sorted;
 * '' = no plan. Strict on save (a typo gets a message naming the token) so
 * the stored strings are always clean; the read side stays lenient.
 */
export function targetSchedule(body) {
  const hm = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const min = Number(m[1]) * 60 + Number(m[2]);
    return Number(m[2]) < 60 && min < 1440 ? min : null;
  };
  const pad = (min) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const tokens = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

  const napTokens = tokens(body.targetNaps);
  if (napTokens.length > 8) {
    throw new ValidationError("That's a lot of naps — keep the plan to 8 or fewer.");
  }
  const naps = napTokens.map((t) => {
    const m = /^(\S+)\s*[-–]\s*(\S+)$/.exec(t);
    const a = m ? hm(m[1]) : null;
    const b = m ? hm(m[2]) : null;
    if (a == null || b == null || b <= a) {
      throw new ValidationError(`Couldn't read "${t}" — write naps as start-end, e.g. 08:30-10:00.`);
    }
    return [a, b];
  }).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < naps.length; i++) {
    if (naps[i][0] < naps[i - 1][1]) {
      throw new ValidationError('Two planned naps overlap — check the times.');
    }
  }

  const feedTokens = tokens(body.targetFeeds);
  if (feedTokens.length > 16) {
    throw new ValidationError("That's a lot of feeds — keep the plan to 16 or fewer.");
  }
  const feeds = feedTokens.map((t) => {
    const min = hm(t);
    if (min == null) {
      throw new ValidationError(`Couldn't read "${t}" — write feed times as HH:MM, e.g. 07:00.`);
    }
    return min;
  }).sort((x, y) => x - y);

  return {
    targetNaps: naps.map(([a, b]) => `${pad(a)}-${pad(b)}`).join(', '),
    targetFeeds: feeds.map(pad).join(', '),
  };
}

/**
 * Build an evenly-spaced target day from counts — the "do it for me" behind
 * the plan fields. All spacing happens here; the client only drops the
 * returned strings into the form. Naps budget ~25% of the awake day asleep
 * (what real nap timetables average out to) split into equal wake windows;
 * feeds spread evenly from wake-up to bedtime; the optional dream feed takes
 * one feed slot and lands 3 hours into the night. The result is a starting
 * point in the same canonical text the form saves, ready to hand-tweak.
 */
export function buildTargetPlan(q) {
  const count = (v, max, what) => {
    const n = Number(v || 0);
    if (!Number.isInteger(n) || n < 0 || n > max) {
      throw new ValidationError(`${what} can be 0 to ${max}.`);
    }
    return n;
  };
  const naps = count(q.naps, 8, 'Naps');
  const feeds = count(q.feeds, 16, 'Feeds');
  const dream = feeds > 0 && (q.dreamFeed === '1' || q.dreamFeed === true);
  if (!naps && !feeds) {
    throw new ValidationError('Add at least one nap or feed to build a plan.');
  }

  // the awake day runs wake-up (night end) → bedtime (night start); the
  // window rides in from the form so an unsaved change still counts, with
  // the same fallbacks the night logic uses
  const hm = (t, dflt) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
    if (!m) return dflt;
    const min = Number(m[1]) * 60 + Number(m[2]);
    return Number(m[2]) < 60 && min < 1440 ? min : dflt;
  };
  const bed = hm(q.nightStart, 19 * 60 + 30);
  const wake = hm(q.nightEnd, 7 * 60 + 30);
  if (bed <= wake) {
    throw new ValidationError('The builder needs a night that crosses midnight — check the night window.');
  }
  const D = bed - wake;
  const r5 = (m) => Math.round(m / 5) * 5;
  const pad = (min) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  // naps: equal 30–90 min each, equal wake windows either side
  const napSpans = [];
  if (naps) {
    const len = Math.min(90, Math.max(30, r5((D * 0.25) / naps)));
    const win = (D - naps * len) / (naps + 1);
    if (win < 20) {
      throw new ValidationError(`${naps} naps won't fit between ${pad(wake)} and ${pad(bed)}.`);
    }
    for (let i = 0; i < naps; i++) {
      const a = r5(wake + (i + 1) * win + i * len);
      napSpans.push([a, a + len]);
    }
  }

  // feeds: evenly spaced in AWAKE time, first on waking, last right before
  // the night. Spacing in wall-clock time and dodging naps afterwards makes
  // a schedule lurch (a feed pushed past a nap leaves a long gap before it
  // and a squeezed one after); walking awake minutes with the naps skipped
  // keeps every gap even, and when the counts line up (feeds = naps + 2)
  // a feed lands on every nap's wake-up — the classic rhythm. The dream
  // feed still takes one slot and goes 3h into the night, capped at 23:55.
  const dayFeeds = feeds - (dream ? 1 : 0);
  const awake = D - napSpans.reduce((t, [a, b]) => t + (b - a), 0);
  const at = (off) => { // awake-minute offset → minute-of-day
    let t = wake;
    for (const [a, b] of napSpans) {
      if (off < a - t - 1e-6) break; // lands in the stretch before this nap
      off -= a - t; // consume the stretch; a boundary hit crosses the nap,
      t = b;        // making that feed the nap's wake-up feed
    }
    return t + off;
  };
  const feedMins = [];
  for (let i = 0; i < dayFeeds; i++) {
    feedMins.push(r5(dayFeeds === 1 ? wake : at((i * awake) / (dayFeeds - 1))));
  }
  if (dream) feedMins.push(Math.min(r5(bed + 180), 1435));
  // 5-min rounding can brush a nap edge or double up — tidy, never lurch
  const placed = [];
  for (let m of feedMins) {
    const nap = napSpans.find(([a, b]) => m > a && m < b);
    if (nap) m = nap[1];
    while (placed.includes(m) && m + 5 < 1440) m += 5;
    placed.push(m);
  }

  // canonicalize through the save-path validator, so the builder can never
  // hand the form something the form couldn't save
  return targetSchedule({
    targetNaps: napSpans.map(([a, b]) => `${pad(a)}-${pad(b)}`).join(', '),
    targetFeeds: placed.map(pad).join(', '),
  });
}

/** Validate an event payload from the client into sheet-layer params. */
export function eventParams(body) {
  const type = String(body.type || '');
  if (!TYPES[type]) throw new ValidationError('Unknown activity type.');
  const startWall = isoToWallMs(body.start);
  if (startWall == null) throw new ValidationError('Please set a valid start time.');
  // the side column is multi-purpose: nursing side for feeds, how much was
  // eaten for solids, night-vs-nap for sleeps — each type accepts only its
  // own vocabulary. A sleep without 'night' is a nap and stores '' so the
  // default costs nothing in the sheet.
  const sides = type === 'solid' ? ['taste', 'some', 'lots']
    : type === 'sleep' ? ['night']
    : type === 'mood' ? ['good', 'mixed', 'bad']
    : type === 'med' || type === 'bottle' ? [] : ['L', 'R', 'both'];
  // a medicine entry is its name+dose text — without it the row says nothing
  if (type === 'med' && !String(body.notes || '').trim()) {
    throw new ValidationError('Which medicine? Add its name (and dose), e.g. Calpol 2.5 ml.');
  }
  const p = {
    type, startWall,
    side: sides.includes(body.side) ? body.side : '',
    amountMl: clampInt(body.amountMl, MAX_ML),
    formulaMl: clampInt(body.formulaMl, MAX_ML),
    notes: safeText(body.notes),
  };
  // an unfinished bottle: the leftover gets its own sheet column
  // (leftover_ml, K); the views deduct it pro-rata from milk and formula.
  // The offered amounts stay the stored record, so the leftover can always
  // be corrected later.
  if (type === 'bottle') {
    const left = clampInt(body.leftoverMl, MAX_ML);
    if (left) {
      const offered = (p.amountMl || 0) + (p.formulaMl || 0);
      if (!offered) {
        throw new ValidationError('Add what was in the bottle before the leftover.');
      }
      if (left > offered) {
        throw new ValidationError(
          `That leftover is more than the ${offered}ml the bottle held.`);
      }
      p.leftoverMl = left;
    }
  }
  const dur = clampInt(body.durationMin, MAX_DURATION_MIN);
  if (dur != null && dur > 0) p.durationMin = dur;
  return p;
}
