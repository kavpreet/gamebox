import type { ComponentType } from 'react';
import type { GameSummary, Seat, GameStatus } from '@gamebox/shared-types';

/** Payload of the server's `game:state` / `tv:state` events. */
export interface LiveState<TView = unknown, TMove = unknown> {
  gameId: string;
  summary: GameSummary;
  seq: number;
  status: GameStatus;
  activeSeats: Seat[];
  view: TView | null;
  result: { winners?: Seat[]; winningTeam?: number; cooperativeLoss?: boolean } | null;
  /** player-only fields */
  yourSeat?: Seat;
  legalMoves?: TMove[];
}

export interface PlayerViewProps<TView = unknown, TMove = unknown> {
  state: LiveState<TView, TMove>;
  yourSeat: Seat;
  /** Submit a move; resolves with an error message, or null on success. */
  submitMove: (type: string, payload: unknown) => Promise<string | null>;
}

export interface TvViewProps<TView = unknown> {
  state: LiveState<TView>;
}

export interface GameUi {
  slug: string;
  PlayerView: ComponentType<PlayerViewProps<any, any>>;
  TvView: ComponentType<TvViewProps<any>>;
}
