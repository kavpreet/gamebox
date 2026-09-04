import type {
  GameOptionDef,
  GameOptionValue,
  GameSummary,
  RoomDTO,
  AdminRoomDTO,
  AllowedEmailDTO,
  MeDTO,
  TableOptions,
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
  description: string;
  minPlayers: number;
  maxPlayers: number;
  teams: 'none' | 'optional' | 'required';
  /** Alternate rules this game supports — rendered as the lobby's house-rules card. */
  options: GameOptionDef[];
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
  createGame: (gameType: string, table?: Partial<TableOptions>) =>
    req<GameSummary>('POST', '/api/games', { gameType, table }),
  /** Table settings — how the match is played, not what its rules are. */
  tableOptions: (id: string) => req<TableOptions>('GET', `/api/games/${id}/table-options`),
  setTableOptions: (id: string, table: Partial<TableOptions>) =>
    req<TableOptions>('POST', `/api/games/${id}/table-options`, table),
  joinByPin: (pin: string) => req<GameSummary>('POST', '/api/games/join', { pin }),
  myGames: () => req<GameSummary[]>('GET', '/api/games/mine'),
  game: (id: string) => req<GameSummary>('GET', `/api/games/${id}`),
  setTeams: (id: string, teams: Record<number, number | null>) =>
    req<GameSummary>('POST', `/api/games/${id}/teams`, { teams }),
  setOptions: (id: string, options: Record<string, GameOptionValue>) =>
    req<GameSummary>('POST', `/api/games/${id}/options`, { options }),
  setAppearance: (id: string, color: string | null, icon: string | null) =>
    req<GameSummary>('POST', `/api/games/${id}/appearance`, { color, icon }),
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
