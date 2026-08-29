import { useEffect, useState, useCallback, useRef } from 'react';
import { api, localDateIso, NeedsSignIn } from '../api.js';
import { Chrome } from '../components/Chrome.jsx';
import { useToast } from '../components/Toast.jsx';
import { MilkChart } from '../components/charts/MilkChart.jsx';
import { PumpChart } from '../components/charts/PumpChart.jsx';

export function Stats() {
  const showToast = useToast();
  const [from, setFrom] = useState(() => localDateIso(13));
  const [to, setTo] = useState(() => localDateIso(0));
  const [data, setData] = useState(null);
  const seq = useRef(0); // drop out-of-order responses while dates are edited

  const load = useCallback(async (f, t) => {
    if (!f || !t || f > t) return; // mid-edit range — wait for a valid one
    const n = ++seq.current;
    try {
      const resp = await api(`/api/stats?from=${f}&to=${t}`);
      if (n === seq.current) setData(resp);
    } catch (err) {
      if (n !== seq.current || err instanceof NeedsSignIn) return;
      showToast('Stats failed to load: ' + err.message, { error: true });
    }
  }, [showToast]);

  useEffect(() => { load(from, to); }, [from, to, load]);

  return (
    <Chrome>
      <div id="statsView">
        <div className="range-custom">
          <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>–</span>
          <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="card">
          <h3>Milk per day (ml)</h3>
          {data && <MilkChart days={data.days} any={data.milk.any} />}
        </div>

        <div className="card">
          <h3>Pumped per day (ml)</h3>
          {data && <div className="trend-note">{data.pump.note}</div>}
          {data && <PumpChart days={data.days} trend={data.pump.trend} any={data.pump.any} />}
        </div>

        <h2>Daily intake (ml)</h2>
        <table className="stat-table">
          <tbody>
            <tr>
              <th>Day</th><th>Feeds</th><th>Breast ≈</th><th>Bottle milk</th>
              <th>Formula</th><th>Total</th><th>Pumped</th>
            </tr>
            {data && data.days.slice().reverse().map((d) => (
              <tr key={d.date}>
                <td title={d.full}>{d.brief}</td>
                <td>{d.feedCount || '–'}</td>
                <td>{d.bfMl || '–'}</td>
                <td>{d.bmMl || '–'}</td>
                <td>{d.fMl || '–'}</td>
                <td><b>{d.totalMl || '–'}</b></td>
                <td>{d.pumpMl || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted table-note">“Feeds” counts breastfeeds and bottles.
          “Bottle milk” is pumped milk given by bottle; “Pumped” is the amount
          pumped that day. Hover a bar for its details.</p>
      </div>
    </Chrome>
  );
}
