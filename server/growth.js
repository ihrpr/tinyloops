/**
 * Growth view: WHO percentile math and the render-ready /api/growth payload.
 *
 * The WHO standards express each measure as an LMS curve per sex and age
 * (Box-Cox power L, median M, coefficient of variation S). A measurement's
 * z-score is ((value/M)^L - 1) / (L*S); the value at a given z is
 * M * (1 + L*S*z)^(1/L). Everything the chart needs — reference centile
 * curves, the baby's points with centile labels, axis domains — is computed
 * here so the client only draws.
 */

import { LMS } from './who-lms.js';
import { isoToWallMs, dayStart, MS_PER_DAY } from './time.js';

const DAYS_PER_MONTH = 30.4375; // the WHO convention used by the tables
// The embedded grid ends at day 730: WHO switches from recumbent length to
// standing height at day 731, so the baby charts stop just before the seam.
export const MAX_AGE_DAYS = 730;

// The nine centile lines of the UK-WHO (RCPCH) growth charts — the red
// book presentation UK parents and health visitors read — spaced exactly
// two-thirds of a standard deviation apart. The curves themselves are the
// same WHO standards; only which lines get drawn differs from WHO's own
// 3rd/15th/50th/85th/97th charts.
const CENTILES = [
  { key: 'p004', label: '0.4th', z: -8 / 3 },
  { key: 'p2', label: '2nd', z: -2 },
  { key: 'p9', label: '9th', z: -4 / 3 },
  { key: 'p25', label: '25th', z: -2 / 3 },
  { key: 'p50', label: '50th', z: 0 },
  { key: 'p75', label: '75th', z: 2 / 3 },
  { key: 'p91', label: '91st', z: 4 / 3 },
  { key: 'p98', label: '98th', z: 2 },
  { key: 'p996', label: '99.6th', z: 8 / 3 },
];

/** LMS at an exact age, interpolated linearly between the sampled rows. */
function lmsAt(table, ageDays) {
  if (ageDays <= table[0][0]) return { l: table[0][1], m: table[0][2], s: table[0][3] };
  for (let i = 1; i < table.length; i++) {
    const [d1, l1, m1, s1] = table[i];
    if (ageDays <= d1) {
      const [d0, l0, m0, s0] = table[i - 1];
      const t = (ageDays - d0) / (d1 - d0);
      return { l: l0 + t * (l1 - l0), m: m0 + t * (m1 - m0), s: s0 + t * (s1 - s0) };
    }
  }
  const last = table[table.length - 1];
  return { l: last[1], m: last[2], s: last[3] };
}

export const valueAtZ = ({ l, m, s }, z) => m * Math.pow(1 + l * s * z, 1 / l);
const zOf = (value, { l, m, s }) => (Math.pow(value / m, l) - 1) / (l * s);

/** Standard normal CDF: Φ(z) = (1 + erf(z/√2))/2, erf via
 *  Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
function cdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function ordinal(n) {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

/** "61st" / "<1st" / ">99th" for a measurement's centile. */
export function centileLabel(sex, measure, ageDays, value) {
  const pct = 100 * cdf(zOf(value, lmsAt(LMS[sex][measure], ageDays)));
  if (pct < 0.5) return '<1st';
  if (pct >= 99.5) return '>99th';
  return ordinal(Math.max(1, Math.round(pct)));
}

/** For the demo generator and tests: the value at a given centile z. */
export function referenceValue(sex, measure, ageDays, z = 0) {
  return valueAtZ(lmsAt(LMS[sex][measure], ageDays), z);
}

// ---------- formatting ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (w) => { const d = new Date(w); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Whole calendar months between two wall times (how parents count age —
 *  dividing by 30.4375 would show "11 months old" on the first birthday). */
function calendarMonths(birthWall, wall) {
  const b = new Date(dayStart(birthWall));
  const d = new Date(dayStart(wall));
  let m = (d.getUTCFullYear() - b.getUTCFullYear()) * 12
    + d.getUTCMonth() - b.getUTCMonth();
  if (d.getUTCDate() < b.getUTCDate()) m--;
  return Math.max(0, m);
}

function fmtAgeAt(birthWall, wall) {
  const days = Math.round((dayStart(wall) - dayStart(birthWall)) / MS_PER_DAY);
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  if (days < 13 * 7) return `${Math.floor(days / 7)} weeks`;
  const m = calendarMonths(birthWall, wall);
  if (m < 24) return `${m} months`;
  const y = Math.floor(m / 12);
  const rm = m % 12;
  return `${y}y` + (rm ? ` ${rm}m` : '');
}

const MEASURES = {
  weight: { field: 'weightKg', unit: 'kg', dp: 2 },
  length: { field: 'heightCm', unit: 'cm', dp: 1 },
};

// ---------- the /api/growth payload ----------

/**
 * measurements: [{id, dateWall, weightKg, heightCm, notes, loggedBy}]
 * settings: the sheet's Settings tab (baby_birth_date, baby_sex live there
 * so both partners share one profile). Without a profile the charts can't
 * place anything on an age axis, so the payload just asks for it.
 */
export function buildGrowth(measurements, settings, nowWall) {
  const birthWall = isoToWallMs(String(settings.baby_birth_date || ''));
  const sex = ['girl', 'boy'].includes(settings.baby_sex) ? settings.baby_sex : null;
  if (birthWall == null || !sex || birthWall > nowWall) {
    return { needsProfile: true, hasEntries: measurements.length > 0 };
  }

  const ageDays = (w) => Math.round((dayStart(w) - dayStart(birthWall)) / MS_PER_DAY);
  const ageNow = ageDays(nowWall);
  const measured = measurements.filter((e) => e.dateWall != null)
    .sort((a, b) => a.dateWall - b.dateWall);

  const charts = {};
  for (const [measure, mm] of Object.entries(MEASURES)) {
    const table = LMS[sex][measure];
    const points = measured
      .filter((e) => e[mm.field] != null)
      .map((e) => ({ age: ageDays(e.dateWall), value: e[mm.field], dateWall: e.dateWall }))
      .filter((p) => p.age >= 0 && p.age <= MAX_AGE_DAYS);

    // window: birth to a bit past the baby's age (or the last point), so the
    // curves are read at the scale that matters now — capped at the 24-month
    // end of the standards
    const maxAge = Math.max(ageNow, ...points.map((p) => p.age), 0);
    const domainMonths = Math.min(24, Math.max(3, Math.ceil(maxAge / DAYS_PER_MONTH + 1)));
    const domainDays = domainMonths * DAYS_PER_MONTH;

    const data = table.filter((row) => row[0] <= domainDays + 4)
      .map((row) => {
        const out = { x: round(row[0] / DAYS_PER_MONTH, 2) };
        const lms = { l: row[1], m: row[2], s: row[3] };
        for (const cnt of CENTILES) out[cnt.key] = round(valueAtZ(lms, cnt.z), mm.dp);
        return out;
      });
    // Measurements landing on a grid day (birth, exact week anniversaries)
    // merge INTO that curve row: duplicate x values give Recharts two
    // tooltip ticks at one pixel and the tip-less curve row wins — a dead
    // zone exactly on the dot. Off-grid measurements get their own row,
    // carrying the curve values at that exact age so the centile lines
    // pass through them unbroken.
    const byX = new Map(data.map((r) => [r.x, r]));
    for (const p of points) {
      const x = round(p.age / DAYS_PER_MONTH, 2);
      const y = round(p.value, mm.dp);
      const tip = `${fmtDate(p.dateWall)} · ${y} ${mm.unit} · ` +
        `${centileLabel(sex, measure, p.age, p.value)} centile`;
      const host = byX.get(x);
      if (host && host.y == null) {
        Object.assign(host, { y, tip });
        continue;
      }
      const row = { x, y, tip };
      const lms = lmsAt(table, p.age);
      for (const cnt of CENTILES) row[cnt.key] = round(valueAtZ(lms, cnt.z), mm.dp);
      data.push(row);
      if (!host) byX.set(x, row);
    }
    data.sort((a, b) => a.x - b.x);

    const ys = data.flatMap((r) => [r.p004, r.p996, r.y]).filter((v) => v != null);
    // y ticks on a "nice" step so the axis reads 45/50/55, not 45/52/59
    const span = Math.max(...ys) - Math.min(...ys);
    const step = span > 15 ? 5 : span > 6 ? 2 : 1;
    const y0 = Math.floor(Math.min(...ys) / step) * step;
    const y1 = Math.ceil(Math.max(...ys) / step) * step;
    const last = points[points.length - 1];
    charts[measure] = {
      unit: mm.unit,
      data,
      xTicks: Array.from({ length: domainMonths + 1 }, (_, i) => i)
        .filter((i) => domainMonths <= 8 || i % 2 === 0),
      xMax: domainMonths,
      yDomain: [y0, y1],
      yTicks: Array.from({ length: (y1 - y0) / step + 1 }, (_, i) => y0 + i * step),
      centiles: CENTILES.map((cnt) => ({ key: cnt.key, label: cnt.label })),
      latest: last ? {
        text: `${round(last.value, mm.dp)} ${mm.unit} · ` +
          `${centileLabel(sex, measure, last.age, last.value)} centile at ` +
          (last.age === 0 ? 'birth' : fmtAgeAt(birthWall, last.dateWall)),
      } : null,
      empty: points.length === 0,
    };
  }

  const entries = measured.slice().reverse().map((e) => {
    const age = ageDays(e.dateWall);
    const cell = (measure, mm) => (e[mm.field] == null ? null : {
      value: `${round(e[mm.field], mm.dp)}`,
      centile: age >= 0 && age <= MAX_AGE_DAYS
        ? centileLabel(sex, measure, age, e[mm.field]) : '—',
    });
    return {
      id: e.id,
      date: fmtDate(e.dateWall),
      age: age === 0 ? 'birth' : age > 0 ? fmtAgeAt(birthWall, e.dateWall) : '—',
      weight: cell('weight', MEASURES.weight),
      height: cell('length', MEASURES.length),
      notes: e.notes || '',
      by: e.loggedBy ? e.loggedBy.split('@')[0] : '',
    };
  });

  return {
    needsProfile: false,
    profile: {
      birthDate: String(settings.baby_birth_date),
      birthLabel: `${fmtDate(birthWall)} ${new Date(birthWall).getUTCFullYear()}`,
      sex,
      ageLabel: fmtAgeAt(birthWall, nowWall) + ' old',
    },
    pastStandards: ageNow > MAX_AGE_DAYS,
    charts,
    entries,
  };
}
