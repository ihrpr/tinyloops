import { createBrowserRouter } from 'react-router-dom';
import { api, NeedsSignIn, DEMO } from './api.js';
import { App } from './App.jsx';
import { ErrorScreen } from './components/ErrorScreen.jsx';
import { SignIn } from './routes/SignIn.jsx';
import { Connect } from './routes/Connect.jsx';
import { Tracker } from './routes/Tracker.jsx';
import { Stats } from './routes/Stats.jsx';
import { Growth } from './routes/Growth.jsx';
import { Privacy, Terms } from './routes/Legal.jsx';

// Resolve the session once at the app root: decides sign-in vs connect vs
// the tracker. The App shell reads this (via useOutletContext) and redirects
// as needed; individual views then fetch their own data.
async function rootLoader() {
  if (DEMO) return { email: 'demo@example.com', hasSheet: true, demo: true };
  try {
    return await api('/api/me');
  } catch (err) {
    if (err instanceof NeedsSignIn) return { signedOut: true };
    throw err;
  }
}

export const router = createBrowserRouter([
  // Public legal pages — outside the App shell so they load without any
  // session lookup or sign-in redirect (they're linked from the Google
  // OAuth consent screen).
  { path: '/privacy', element: <Privacy />, errorElement: <ErrorScreen /> },
  { path: '/terms', element: <Terms />, errorElement: <ErrorScreen /> },
  {
    path: '/',
    element: <App />,
    errorElement: <ErrorScreen />,
    loader: rootLoader,
    children: [
      { index: true, element: <Tracker /> },
      { path: 'stats', element: <Stats /> },
      { path: 'growth', element: <Growth /> },
      { path: 'connect', element: <Connect /> },
      { path: 'signin', element: <SignIn /> },
    ],
  },
]);
