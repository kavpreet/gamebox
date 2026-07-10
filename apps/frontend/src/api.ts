import type { GameSummary, RoomDTO } from '@gamebox/shared-types';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface GameTypeInfo {
  slug: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  teams: 'none' | 'optional' | 'required';
}

export interface AuthConfig {
  emailPassword: boolean;
  google: boolean;
}

export const api = {
  authConfig: () => req<AuthConfig>('GET', '/api/auth-config'),
  gameTypes: () => req<GameTypeInfo[]>('GET', '/api/game-types'),
  createGame: (gameType: string) => req<GameSummary>('POST', '/api/games', { gameType }),
  joinByPin: (pin: string) => req<GameSummary>('POST', '/api/games/join', { pin }),
  myGames: () => req<GameSummary[]>('GET', '/api/games/mine'),
  game: (id: string) => req<GameSummary>('GET', `/api/games/${id}`),
  setTeams: (id: string, teams: Record<number, number | null>) =>
    req<GameSummary>('POST', `/api/games/${id}/teams`, { teams }),
  startGame: (id: string) => req<GameSummary>('POST', `/api/games/${id}/start`),
  abandonGame: (id: string) => req<{ ok: boolean }>('POST', `/api/games/${id}/abandon`),
  rooms: () => req<RoomDTO[]>('GET', '/api/rooms'),
  assignRoom: (code: string, gameId: string | null) =>
    req<RoomDTO>('POST', `/api/rooms/${code}/assign`, { gameId }),
};
