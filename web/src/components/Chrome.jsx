import { NavLink } from 'react-router-dom';
import { DEMO } from '../api.js';

// Shared tracker chrome: the topbar (brand, date, data link, settings gear)
// and the Log/Stats tabs. `topDate`, `sheetUrl`, and `onSettings` are only
// present on the Log view; Stats passes what it has.
export function Chrome({ topDate, sheetUrl, onSettings, children }) {
  return (
    <section id="view-app">
      <div className="topbar">
        <div className="brand">
          <img className="logo" src="/icons/icon-192.png" alt="" />
          <div>
            <h1>Tinyloops</h1>
            {topDate && <div className="brand-sub">{topDate}</div>}
          </div>
        </div>
        <div className="top-actions">
          {sheetUrl && !DEMO && (
            <a className="sheet-link" href={sheetUrl} target="_blank" rel="noopener">📊 Data</a>
          )}
          {onSettings && (
            <button className="icon-btn" aria-label="Settings" onClick={onSettings}>⚙️</button>
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
