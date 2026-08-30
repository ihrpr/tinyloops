import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { pickSpreadsheet } from '../picker.js';
import { Mark } from '../components/icons.jsx';

export function Connect() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  const say = (msg, isError = false) => { setStatus(msg); setError(isError); };

  async function createSheet() {
    try {
      say('Creating your tracker sheet…');
      await api('/api/sheet', { method: 'POST' });
      navigate('/', { replace: true });
    } catch (err) {
      say('Could not create the sheet: ' + err.message, true);
    }
  }

  async function pickSheet() {
    try {
      const picked = await pickSpreadsheet();
      if (!picked) return;
      say('Checking the sheet…');
      await api('/api/sheet', { method: 'PUT', body: { spreadsheetId: picked } });
      navigate('/', { replace: true });
    } catch (err) {
      say(err.message, true);
    }
  }

  return (
    <section id="view-connect">
      <div className="brand" style={{ marginBottom: 14 }}>
        <span className="brand-mark"><Mark size={28} color="#f3f1e2" /></span>
        <h1 style={{ marginBottom: 0 }}>tinyloops</h1>
      </div>
      <div className="card">
        <h2>Set up your tracker</h2>
        <p>Your data lives in a Google Sheet. Create a new one, or open one
          that was shared with you.</p>
        <button className="primary" onClick={createSheet}>Create a new tracker sheet</button>
        <p className="muted">We&apos;ll create an empty spreadsheet called “Tinyloops”
          in your Google Drive. You can open, export or delete it at any time.</p>
        <button className="secondary" onClick={pickSheet}>Open an existing tracker sheet</button>
        <p className="muted">Already tracking, or joining a partner? If a tracker
          sheet was shared with you, pick it here to connect this device.</p>
      </div>
      <div className="card">
        <h2>Sharing with a partner</h2>
        <p className="muted">Both steps are needed: 1) share the sheet with them as
          Editor from Google Sheets; 2) they sign in here and use “Open an
          existing tracker sheet” to pick it.</p>
      </div>
      {status && <p className={'status' + (error ? ' error' : '')}>{status}</p>}
      <p className="legal-links">
        <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
      </p>
    </section>
  );
}
