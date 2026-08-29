import { useRouteError } from 'react-router-dom';

// Router-level error boundary: shown when a loader or render throws
// (e.g. /api/me unreachable on first paint), instead of React Router's
// default unstyled stack-trace page.
export function ErrorScreen() {
  const error = useRouteError();
  return (
    <main className="wrap">
      <div className="card">
        <h2>Something went wrong</h2>
        <p className="status error">
          {(error && (error.message || error.statusText)) || 'Unexpected error.'}
        </p>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </div>
    </main>
  );
}
