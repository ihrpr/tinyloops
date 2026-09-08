// Left/Right/Both segmented control. Controlled: value is '' | 'L' | 'R' | 'both'.
const SIDES = [['L', 'Left'], ['R', 'Right'], ['both', 'Both']];

function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={value === v ? 'on' : ''}
          onClick={() => onChange(value === v ? '' : v)}
        >{label}</button>
      ))}
    </div>
  );
}

export function SideSeg({ value, onChange }) {
  return <Seg options={SIDES} value={value} onChange={onChange} />;
}

// How much of the solids meal went down. Same column as the nursing side —
// the server accepts each vocabulary only for its own type.
const EATEN = [['taste', 'Just a taste'], ['some', 'Some'], ['lots', 'Lots']];

export function EatenSeg({ value, onChange }) {
  return <Seg options={EATEN} value={value} onChange={onChange} />;
}

// Nap or night sleep. '' is the nap default (costs nothing in the sheet), so
// the summary can total the night — across midnight — apart from the naps.
const SLEEP_KIND = [['', 'Nap'], ['night', 'Night']];

export function SleepSeg({ value, onChange }) {
  return <Seg options={SLEEP_KIND} value={value} onChange={onChange} />;
}
