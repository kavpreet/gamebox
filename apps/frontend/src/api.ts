import type {
  GameOptions,
  GameSummary,
  RoomDTO,
  AdminRoomDTO,
  AllowedEmailDTO,
  MeDTO,
} from '@gamebox/shared-types';

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
  /** Whether this game splits its moves into hand-played steps (manual mode). */
  supportsManual: boolean;
}

export interface AuthConfig {
  emailPassword: boolean;
  google: boolean;
}

export const api = {
  authConfig: () => req<AuthConfig>('GET', '/api/auth-config'),
  gameTypes: () => req<GameTypeInfo[]>('GET', '/api/game-types'),
  createGame: (gameType: string, options?: Partial<GameOptions>) =>
    req<GameSummary>('POST', '/api/games', { gameType, options }),
  gameOptions: (id: string) => req<GameOptions>('GET', `/api/games/${id}/options`),
  setGameOptions: (id: string, options: Partial<GameOptions>) =>
    req<GameOptions>('POST', `/api/games/${id}/options`, options),
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

  me: () => req<MeDTO>('GET', '/api/me'),

  /** TV pairing — the only call the kiosk makes without a session. */
  pairTv: (room: string, pin: string) =>
    req<{ token: string; room: RoomDTO }>('POST', '/api/tv/pair', { room, pin }),

  admin: {
    rooms: () => req<AdminRoomDTO[]>('GET', '/api/admin/rooms'),
    createRoom: (name: string, pairingCode: string, pin: string) =>
      req<AdminRoomDTO[]>('POST', '/api/admin/rooms', { name, pairingCode, pin }),
    updateRoom: (id: string, patch: { name?: string; pin?: string }) =>
      req<AdminRoomDTO[]>('PATCH', `/api/admin/rooms/${id}`, patch),
    revokeRoom: (id: string) => req<AdminRoomDTO[]>('POST', `/api/admin/rooms/${id}/revoke`),
    roomToken: (id: string) => req<{ token: string }>('POST', `/api/admin/rooms/${id}/token`),
    deleteRoom: (id: string) => req<AdminRoomDTO[]>('DELETE', `/api/admin/rooms/${id}`),
    users: () => req<AllowedEmailDTO[]>('GET', '/api/admin/users'),
    addUser: (email: string) => req<AllowedEmailDTO[]>('POST', '/api/admin/users', { email }),
    removeUser: (email: string) =>
      req<AllowedEmailDTO[]>('DELETE', `/api/admin/users/${encodeURIComponent(email)}`),
  },
};
