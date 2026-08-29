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

/** Validate an event payload from the client into sheet-layer params. */
export function eventParams(body) {
  const type = String(body.type || '');
  if (!TYPES[type]) throw new ValidationError('Unknown activity type.');
  const startWall = isoToWallMs(body.start);
  if (startWall == null) throw new ValidationError('Please set a valid start time.');
  const p = {
    type, startWall,
    side: ['L', 'R', 'both'].includes(body.side) ? body.side : '',
    amountMl: clampInt(body.amountMl, MAX_ML),
    formulaMl: clampInt(body.formulaMl, MAX_ML),
    notes: safeText(body.notes),
  };
  const dur = clampInt(body.durationMin, MAX_DURATION_MIN);
  if (dur != null && dur > 0) p.durationMin = dur;
  return p;
}
