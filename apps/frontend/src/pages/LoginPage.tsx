import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authClient, useSession } from '../auth-client.js';
import { api, type AuthConfig } from '../api.js';

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/';
  const { data: session } = useSession();
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then(setAuthConfig).catch(() => setAuthConfig({ emailPassword: true, google: false }));
  }, []);

  useEffect(() => {
    if (session) navigate(redirect, { replace: true });
  }, [session, navigate, redirect]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result =
        mode === 'signin'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name: name || email.split('@')[0]! });
      if (result.error) {
        setError(result.error.message ?? 'Sign-in failed');
      } else {
        navigate(redirect, { replace: true });
      }
    } catch {
      setError('Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    await authClient.signIn.social({ provider: 'google', callbackURL: redirect });
  };

  return (
    <div className="page" style={{ justifyContent: 'center' }}>
      <div className="card">
        <h1 className="center">
          Game<span style={{ color: 'var(--accent)' }}>Box</span>
        </h1>
        {authConfig?.google && (
          <button onClick={googleSignIn}>Continue with Google</button>
        )}
        {authConfig?.google && authConfig?.emailPassword && <p className="center dim small">— or —</p>}
        {authConfig?.emailPassword && (
          <>
            {mode === 'signup' && (
              <input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button onClick={submit} disabled={busy || !email || !password}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            <button className="ghost" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
              {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>
          </>
        )}
        {error && <p className="error center">{error}</p>}
        {authConfig && !authConfig.emailPassword && !authConfig.google && (
          <p className="error center">No sign-in methods are enabled — check server configuration.</p>
        )}
      </div>
    </div>
  );
}
