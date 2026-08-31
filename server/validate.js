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

/** Validate an event payload from the client into sheet-layer params. */
export function eventParams(body) {
  const type = String(body.type || '');
  if (!TYPES[type]) throw new ValidationError('Unknown activity type.');
  const startWall = isoToWallMs(body.start);
  if (startWall == null) throw new ValidationError('Please set a valid start time.');
  // the side column is dual-purpose: nursing side for feeds, how much was
  // eaten for solids — each type accepts only its own vocabulary
  const sides = type === 'solid' ? ['taste', 'some', 'lots'] : ['L', 'R', 'both'];
  const p = {
    type, startWall,
    side: sides.includes(body.side) ? body.side : '',
    amountMl: clampInt(body.amountMl, MAX_ML),
    formulaMl: clampInt(body.formulaMl, MAX_ML),
    notes: safeText(body.notes),
  };
  const dur = clampInt(body.durationMin, MAX_DURATION_MIN);
  if (dur != null && dur > 0) p.durationMin = dur;
  return p;
}
