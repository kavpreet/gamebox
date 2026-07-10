import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../auth-client.js';
import { api } from '../api.js';

/** Deep-link target of the TV's QR code: /join/<pin>. */
export function JoinPage() {
  const { pin } = useParams<{ pin: string }>();
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState('');

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      navigate(`/login?redirect=${encodeURIComponent(`/join/${pin}`)}`, { replace: true });
      return;
    }
    if (!pin) return;
    api
      .joinByPin(pin)
      .then((game) => navigate(`/game/${game.id}`, { replace: true }))
      .catch((err) => setError((err as Error).message));
  }, [session, isPending, pin, navigate]);

  return (
    <div className="page" style={{ justifyContent: 'center' }}>
      <div className="card center">
        {error ? (
          <>
            <p className="error">{error}</p>
            <button onClick={() => navigate('/')}>Back home</button>
          </>
        ) : (
          <p className="dim">Joining game {pin}…</p>
        )}
      </div>
    </div>
  );
}
