/**
 * The client's entire data layer: fetch wrappers around /api/*.
 * All logic lives on the server — every GET returns render-ready JSON,
 * every write returns a fresh home payload. The only "computation" here is
 * reading the phone's clock, which travels with each request as `now`
 * (a naive local ISO string) so the server knows what "today" means.
 */

export const DEMO = new URLSearchParams(location.search).has('demo');

export class NeedsSignIn extends Error {
  constructor() {
    super('Sign-in required');
    this.name = 'NeedsSignIn';
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** The device's wall clock as a naive ISO string ("2026-08-29T14:02"). */
export function localNowIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date string N days ago ("2026-08-16") — for the range inputs. */
export function localDateIso(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function api(path, { method = 'GET', body = null } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  let url = `${path}${sep}now=${encodeURIComponent(localNowIso())}`;
  if (DEMO) url += '&demo=1';
  const resp = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) throw new NeedsSignIn();
  let data = null;
  try {
    data = await resp.json();
  } catch {
    /* non-JSON error page */
  }
  if (!resp.ok) {
    const err = new Error((data && data.error) || `${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}
