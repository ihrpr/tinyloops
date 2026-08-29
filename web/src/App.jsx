import { useLoaderData, useLocation, Navigate, Outlet } from 'react-router-dom';
import { ToastProvider } from './components/Toast.jsx';

// The app shell: resolves which top-level screen the session allows and wraps
// everything in the toast provider. The tracker screens render their own
// chrome (topbar + tabs) via the Chrome component. Session comes from the
// root loader (see router.jsx).
export function App() {
  const session = useLoaderData();
  const { pathname } = useLocation();

  const onSignin = pathname === '/signin';
  const onConnect = pathname === '/connect';

  if (session.signedOut && !onSignin) return <Navigate to="/signin" replace />;
  if (!session.signedOut && !session.hasSheet && !onConnect) {
    return <Navigate to="/connect" replace />;
  }
  if (!session.signedOut && session.hasSheet && (onSignin || onConnect)) {
    return <Navigate to="/" replace />;
  }

  return (
    <ToastProvider>
      <main className="wrap">
        <Outlet context={session} />
      </main>
    </ToastProvider>
  );
}
