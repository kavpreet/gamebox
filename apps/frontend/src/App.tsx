import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { useSession, signOut } from './auth-client.js';
import { api } from './api.js';
import { LoginPage } from './pages/LoginPage.js';
import { HomePage } from './pages/HomePage.js';
import { JoinPage } from './pages/JoinPage.js';
import { GamePage } from './pages/GamePage.js';
import { TvPage } from './pages/TvPage.js';
import { AdminPage } from './pages/AdminPage.js';

/**
 * Admin status comes from the server (ADMIN_EMAILS), never from the session —
 * this only decides what to *render*; every admin endpoint re-checks.
 * `undefined` = still loading.
 */
function useIsAdmin(enabled: boolean): boolean | undefined {
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setIsAdmin(false);
      return;
    }
    let live = true;
    api
      .me()
      .then((me) => live && setIsAdmin(me.isAdmin))
      .catch(() => live && setIsAdmin(false));
    return () => {
      live = false;
    };
  }, [enabled]);
  return isAdmin;
}

function TopBar() {
  const { data: session } = useSession();
  const location = useLocation();
  const isAdmin = useIsAdmin(Boolean(session));
  if (location.pathname.startsWith('/tv') || location.pathname === '/login') return null;
  return (
    <div className="topbar">
      <Link to="/" className="logo">
        Game<span>Box</span>
      </Link>
      {session && (
        <div className="row">
          {isAdmin && (
            <Link to="/admin" className="dim small">
              Admin
            </Link>
          )}
          <span className="dim small">{session.user.name}</span>
          <button className="ghost" onClick={() => signOut().then(() => window.location.assign('/login'))}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const isAdmin = useIsAdmin(Boolean(session));
  const location = useLocation();
  if (isPending || (session && isAdmin === undefined)) return null;
  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Auth guard for player-facing routes. /tv stays unguarded (the TV pairs with
 * a room code, not a user session); /login redirects back out via LoginPage's
 * own session effect.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  if (isPending) return null; // don't flash the lobby (or a redirect) while the session loads
  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <TopBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
        <Route path="/join/:pin" element={<RequireAuth><JoinPage /></RequireAuth>} />
        <Route path="/game/:id" element={<RequireAuth><GamePage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="/tv" element={<TvPage />} />
      </Routes>
    </BrowserRouter>
  );
}
