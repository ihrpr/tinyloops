/**
 * The tinyloops icon set: the loop-de-loop mark plus one hand-drawn stroke
 * icon per activity (and a few extras for the summary and sign-in screens).
 * Everything strokes `currentColor`, so tinting is pure CSS via `.icn.t-*`.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** The loop-de-loop brand mark: one continuous line, one loop. */
export function Mark({ size = 40, color = 'currentColor', strokeWidth = 4.4 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M5 31 C 17 31 30 28 31.5 19 C 32.5 12 22.5 10.5 21.5 17.5 C 20.5 25 31 28.5 43 25"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
      />
    </svg>
  );
}

const PATHS = {
  feed: <path d="M12 21C7.2 16.8 3.8 13.6 3.8 9.9A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.2 2.9c0 3.7-3.4 6.9-8.2 11.1Z" />,
  bottle: <><path d="M10 8h4V5.8a2 2 0 1 0-4 0Z" /><rect x="8" y="8" width="8" height="13" rx="3" /><path d="M8 12.5h8M8 16.5h8" /></>,
  solid: <><path d="M4.5 12.5h15a7.5 7.5 0 0 1-15 0Z" /><path d="M14.5 12.5l3.3-5.9" /><circle cx="18.7" cy="4.9" r="1.8" /></>,
  sleep: <path d="M20.4 13.6A8.5 8.5 0 1 1 10.4 3.6a6.8 6.8 0 0 0 10 10Z" />,
  play: <><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.6" /><rect x="8.25" y="3.5" width="7.5" height="7.5" rx="1.6" /><path d="M12 7.2h.01" strokeWidth="2.4" /></>,
  pump: <><path d="M8.5 3.5h7L13.4 9h-2.8Z" /><rect x="9.3" y="9" width="5.4" height="11.5" rx="2.2" /></>,
  wet: <path d="M12 3.5C12 3.5 5.5 11 5.5 15a6.5 6.5 0 0 0 13 0C18.5 11 12 3.5 12 3.5Z" />,
  dirty: <path d="M19.5 13.5a7.5 7.5 0 1 1-7.5-7.5 4.7 4.7 0 0 1 4.7 4.7 3 3 0 0 1-3 3 1.9 1.9 0 0 1-1.9-1.9" />,
  // summary-row extras
  baby: <><circle cx="12" cy="13" r="7.8" /><path d="M9.3 12.2h.01M14.7 12.2h.01" strokeWidth="2.6" /><path d="M9.4 15.6q2.6 2 5.2 0M12 5.2c0-1.6 1-2.2 2.1-2.2" /></>,
  milk: <><path d="M8 3.5h8l-1.3 15.6a2.3 2.3 0 0 1-2.3 2.1h-.8a2.3 2.3 0 0 1-2.3-2.1Z" /><path d="M9 10.5h6" /></>,
  nappies: <><path d="M4.5 8h15v2.2a7.5 7.5 0 0 1-15 0Z" /><path d="M4.5 8a3 3 0 0 1 3-2.5M19.5 8a3 3 0 0 0-3-2.5" /></>,
  // sign-in feature extras
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 13V8.8M12 13l3 2.2M9.5 2.5h5" /></>,
  chart: <path d="M4.5 20.5V13M10 20.5V6.5M15.5 20.5v-9M21 20.5v-12M3 20.5h18" />,
  lock: <><rect x="5.5" y="10.5" width="13" height="10" rx="2.5" /><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7M12 14.8v2" /></>,
};

/** One icon from the set; unknown keys render a small dot so nothing breaks. */
export function TypeIcon({ k }) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      {PATHS[k] || <circle cx="12" cy="12" r="4" />}
    </svg>
  );
}

/** The standard tinted icon chip: `<IconChip k="feed" />`. */
export function IconChip({ k, small }) {
  return (
    <span className={'icn t-' + k + (small ? ' sm' : '')}>
      <TypeIcon k={k} />
    </span>
  );
}

/** Settings-sliders icon for the topbar button. */
export function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 7.5h16M4 16.5h16" />
      <circle cx="9.5" cy="7.5" r="2.4" fill="var(--card)" />
      <circle cx="14.5" cy="16.5" r="2.4" fill="var(--card)" />
    </svg>
  );
}
