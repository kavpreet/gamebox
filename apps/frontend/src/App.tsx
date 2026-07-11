import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { useSession, signOut } from './auth-client.js';
import { LoginPage } from './pages/LoginPage.js';
import { HomePage } from './pages/HomePage.js';
import { JoinPage } from './pages/JoinPage.js';
import { GamePage } from './pages/GamePage.js';
import { TvPage } from './pages/TvPage.js';

function TopBar() {
  const { data: session } = useSession();
  const location = useLocation();
  if (location.pathname.startsWith('/tv') || location.pathname === '/login') return null;
  return (
    <div className="topbar">
      <Link to="/" className="logo">
        Game<span>Box</span>
      </Link>
      {session && (
        <div className="row">
          <span className="dim small">{session.user.name}</span>
          <button className="ghost" onClick={() => signOut().then(() => window.location.assign('/login'))}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
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
        <Route path="/tv" element={<TvPage />} />
      </Routes>
    </BrowserRouter>
  );
}
