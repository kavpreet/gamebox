import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
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

export function App() {
  return (
    <BrowserRouter>
      <TopBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:pin" element={<JoinPage />} />
        <Route path="/game/:id" element={<GamePage />} />
        <Route path="/tv" element={<TvPage />} />
      </Routes>
    </BrowserRouter>
  );
}
