/**
 * The frozen sheet time format — the single place in the codebase that
 * understands how times are stored.
 *
 * Datetimes in the Log tab are native spreadsheet datetime cells: read with
 * UNFORMATTED_VALUE they arrive as day-serial numbers, and they are written
 * back as serial numbers with valueInputOption=RAW. Serial numbers are used
 * instead of date strings deliberately: strings go through Sheets'
 * locale-dependent parsing (dd/MM vs MM/dd), which is a proven way to
 * corrupt data. Never change this.
 *
 * A serial is a timezone-naive wall-clock time (the Google Sheets
 * convention). Inside the server, wall-clock times are held as "wall ms":
 * milliseconds since the Unix epoch *as if the wall-clock digits were UTC*.
 * Wall ms are not instants — they exist so arithmetic, sorting and
 * day-boundary math stay trivial and timezone-free. At the API edge they
 * become naive ISO strings ("2026-08-29T14:02"), which feed
 * <input type="datetime-local"> unchanged in both directions. The phone's
 * clock is the source of "now", sent by the client with each request, so
 * "today" always means the user's today.
 */

export const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
export const MS_PER_DAY = 86400000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_MIN = 60000;

/** Sheet serial → wall ms, rounded to whole seconds to shed float noise. */
export function serialToWallMs(serial) {
  return Math.round((SHEETS_EPOCH_MS + serial * MS_PER_DAY) / 1000) * 1000;
}

/** Inverse of serialToWallMs — the only value ever written to a time cell. */
export function wallMsToSerial(wallMs) {
  return (wallMs - SHEETS_EPOCH_MS) / MS_PER_DAY;
}

const pad = (n) => String(n).padStart(2, '0');

/** Wall ms → naive ISO to the minute ("2026-08-29T14:02"). */
export function wallMsToIso(wallMs) {
  const d = new Date(wallMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Naive ISO ("2026-08-29T14:02", optional :ss) → wall ms, or null.
 * Also accepts a bare date ("2026-08-29") as that day's midnight.
 *
 * Validates the components strictly: Date.UTC silently rolls impossible
 * values over ("2026-13-05" → 2027-01-05, "14:99" → 15:39), which would
 * write a plausible-looking but WRONG datetime to the sheet. We reject
 * anything that doesn't round-trip to exactly what was parsed, and bound
 * the year to a sane window.
 */
export function isoToWallMs(v) {
  if (v == null || v === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
    .exec(String(v).trim());
  if (!m) return null;
  const [Y, Mo, D, H, Mi, S] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  if (Y < 1970 || Y > 2200) return null;
  if (Mo < 1 || Mo > 12 || D < 1 || D > 31) return null;
  if (H > 23 || Mi > 59 || S > 59) return null;
  const ms = Date.UTC(Y, Mo - 1, D, H, Mi, S);
  // reject rollover (e.g. Feb 31 → Mar 3): the date must survive intact
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Y || d.getUTCMonth() !== Mo - 1 || d.getUTCDate() !== D) return null;
  return ms;
}

/** A time cell's raw value → wall ms. Numbers are serials; legacy string
 *  cells (they should not exist, but rows have survived odd states before)
 *  are parsed as naive ISO; anything else is null. */
export function cellToWallMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialToWallMs(v);
  return isoToWallMs(v);
}

/** Midnight of the wall-clock day containing wallMs. */
export function dayStart(wallMs) {
  return Math.floor(wallMs / MS_PER_DAY) * MS_PER_DAY;
}

/** Bare date part of a wall ms ("2026-08-29"). */
export function wallMsToDate(wallMs) {
  return wallMsToIso(dayStart(wallMs)).slice(0, 10);
}
