import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * The selected day on the tracker — one server-built day payload that both
 * the Day summary card and the entry list render. The home payload carries
 * the recent days; paging further back follows each day's server-computed
 * `prev`/`next` pointers (or jumps via the date picker) and fetches
 * /api/days/:date, cached until the next write. All date arithmetic and
 * labels happen on the server; this hook only follows links.
 */
export function useDay(home) {
  const days = home?.summary?.days || null;
  const [date, setDate] = useState(null); // null = today, following the clock
  const [older, setOlder] = useState({}); // date → fetched day payload
  const [error, setError] = useState('');

  const today = days ? days[days.length - 1] : null;
  const inHome = date == null ? today : days?.find((x) => x.date === date) || null;
  const day = inHome || (date != null ? older[date] || null : null);

  // fetch a day the home window doesn't cover — once, cached until a write
  useEffect(() => {
    if (date == null || day) return;
    let gone = false;
    api(`/api/days/${date}`)
      .then((data) => { if (!gone) setOlder((prev) => ({ ...prev, [date]: data })); })
      .catch((err) => { if (!gone) setError(err.message); });
    return () => { gone = true; };
  }, [date, day]);

  const go = useCallback((to) => {
    setError('');
    // landing back on today resumes following the clock across midnight
    setDate(to && to !== today?.date ? to : null);
  }, [today?.date]);

  const prev = () => { if (day?.prev) go(day.prev); };
  const next = () => {
    if (!day) return go(null); // a failed fetch leaves no `next` — lead home
    if (day.next) go(day.next);
  };

  // a write can touch any day — drop the cache so the shown one refetches
  const invalidate = useCallback(() => setOlder({}), []);

  return { day, error, go, prev, next, invalidate };
}
