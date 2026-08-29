// Left/Right/Both segmented control. Controlled: value is '' | 'L' | 'R' | 'both'.
const SIDES = [['L', 'Left'], ['R', 'Right'], ['both', 'Both']];

export function SideSeg({ value, onChange }) {
  return (
    <div className="seg">
      {SIDES.map(([v, label]) => (
        <button
          key={v}
          className={value === v ? 'on' : ''}
          onClick={() => onChange(value === v ? '' : v)}
        >{label}</button>
      ))}
    </div>
  );
}
