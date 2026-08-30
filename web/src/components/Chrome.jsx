import { NavLink } from 'react-router-dom';
import { DEMO } from '../api.js';
import { Mark, SlidersIcon } from './icons.jsx';

// Shared tracker chrome: the topbar (brand, date, data link, settings) and
// the Log/Stats tabs. `topDate`, `sheetUrl`, and `onSettings` are only
// present on the Log view; Stats passes what it has.
export function Chrome({ topDate, sheetUrl, onSettings, children }) {
  return (
    <section id="view-app">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark"><Mark size={28} color="#f3f1e2" /></span>
          <div>
            <h1>tinyloops</h1>
            {topDate && <div className="brand-sub">{topDate}</div>}
          </div>
        </div>
        <div className="top-actions">
          {sheetUrl && !DEMO && (
            <a className="sheet-link" href={sheetUrl} target="_blank" rel="noopener">Data ↗</a>
          )}
          {onSettings && (
            <button className="icon-btn" aria-label="Settings" onClick={onSettings}><SlidersIcon /></button>
          )}
        </div>
      </div>

      <div className="tabs">
        <NavLink to="/" end className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>Log</NavLink>
        <NavLink to="/stats" className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>Stats</NavLink>
      </div>

      {children}
    </section>
  );
}
