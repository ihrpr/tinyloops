import { useCallback, useEffect, useRef, useState } from 'react';
import { api, NeedsSignIn } from './api.js';

/**
 * Owns the /api/home payload — the whole tracker view state. Writes go
 * through `run`, whose response carries a fresh home payload so the UI
 * updates in one round trip (the server is the single source of truth).
 * Also refetches on focus/visibility and on a slow interval to pick up a
 * partner's entries and keep timers fresh.
 */
export function useHome() {
  const [home, setHome] = useState(null);
  const [status, setStatus] = useState('Loading…');
  const [needsReauth, setNeedsReauth] = useState(false);
  const loading = useRef(false);
  const saving = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const data = await api('/api/home');
      setHome(data);
      setStatus('');
      setNeedsReauth(false);
    } catch (err) {
      if (err instanceof NeedsSignIn) {
        // keep data on screen; offer reconnect rather than bouncing to sign-in
        setHome((h) => { if (!h) location.href = '/signin'; return h; });
        setNeedsReauth(true);
      } else {
        setStatus(navigator.onLine === false
          ? 'You’re offline — entries can’t load or save until you reconnect.'
          : 'Failed to load: ' + err.message);
      }
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // refetch when the app regains focus / on a slow tick
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !saving.current) load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const tick = setInterval(refresh, 45000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(tick);
    };
  }, [load]);

  /**
   * Run a write; its response's fresh home payload re-renders the UI.
   * Returns the response (or null on failure). `onError` reports via a toast.
   */
  const run = useCallback(async (fn, onError) => {
    saving.current = true;
    try {
      const resp = await fn();
      if (resp && resp.home) setHome(resp.home);
      return resp || {};
    } catch (err) {
      if (err instanceof NeedsSignIn) {
        setNeedsReauth(true);
        onError?.('Your Google session expired — sign back in above, then try again.');
      } else {
        onError?.(navigator.onLine === false
          ? 'You’re offline — this wasn’t saved. Try again when connected.'
          : 'Could not save: ' + (err.message || err));
      }
      return null;
    } finally {
      saving.current = false;
    }
  }, []);

  return { home, status, needsReauth, load, run };
}
