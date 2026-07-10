import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { Chess } from 'chess.js';

/**
 * Chess — move legality, check(mate), castling, en passant, promotion and
 * draw detection all delegated to chess.js (plan §4.4: don't reinvent).
 * Seat 0 = white, seat 1 = black. State of record = FEN + SAN history.
 */

export interface ChessPublic {
  fen: string;
  history: string[]; // SAN moves
  turn: 'w' | 'b';
  inCheck: boolean;
  lastMove: { from: string; to: string } | null;
  result: 'white' | 'black' | 'draw' | null;
  resultReason: string | null;
}

export type ChessPrivate = Record<string, never>;
export type ChessMove = { kind: 'MOVE'; from: string; to: string; promotion?: string };

type State = GameState<ChessPublic, ChessPrivate>;

function engine(pub: ChessPublic): Chess {
  return new Chess(pub.fen);
}

function refresh(pub: ChessPublic, chess: Chess): void {
  pub.fen = chess.fen();
  pub.turn = chess.turn();
  pub.inCheck = chess.inCheck();
  if (chess.isCheckmate()) {
    pub.result = chess.turn() === 'w' ? 'black' : 'white';
    pub.resultReason = 'checkmate';
  } else if (chess.isStalemate()) {
    pub.result = 'draw';
    pub.resultReason = 'stalemate';
  } else if (chess.isThreefoldRepetition()) {
    pub.result = 'draw';
    pub.resultReason = 'threefold repetition';
  } else if (chess.isInsufficientMaterial()) {
    pub.result = 'draw';
    pub.resultReason = 'insufficient material';
  } else if (chess.isDraw()) {
    pub.result = 'draw';
    pub.resultReason = '50-move rule';
  }
}

export const chess: GameModule<ChessPublic, ChessPrivate, ChessMove> = {
  slug: 'chess',
  displayName: 'Chess',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 2,
  teams: 'none',

  setup(seats) {
    const c = new Chess();
    const priv: Record<Seat, ChessPrivate> = {};
    for (const { seat } of seats) priv[seat] = {};
    return {
      public: {
        fen: c.fen(),
        history: [],
        turn: 'w',
        inCheck: false,
        lastMove: null,
        result: null,
        resultReason: null,
      },
      private: priv,
    };
  },

  activePlayers(state: State) {
    const pub = state.public;
    if (pub.result !== null) return [];
    return [pub.turn === 'w' ? 0 : 1];
  },

  moves: {
    MOVE({ state, seat, payload }) {
      const pub = state.public;
      if (pub.result !== null) throw new IllegalMove('Game is over');
      const mySide = seat === 0 ? 'w' : 'b';
      if (pub.turn !== mySide) throw new IllegalMove('Not your turn');

      const { from, to, promotion } = payload as { from: string; to: string; promotion?: string };
      const c = engine(pub);
      let made;
      try {
        made = c.move({ from, to, promotion: promotion ?? 'q' });
      } catch {
        throw new IllegalMove('Illegal move');
      }
      if (!made) throw new IllegalMove('Illegal move');
      pub.history.push(made.san);
      pub.lastMove = { from: made.from, to: made.to };
      refresh(pub, c);
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.result !== null) return [];
    const mySide = seat === 0 ? 'w' : 'b';
    if (pub.turn !== mySide) return [];
    return engine(pub)
      .moves({ verbose: true })
      .map((m) => ({
        kind: 'MOVE' as const,
        from: m.from,
        to: m.to,
        ...(m.promotion ? { promotion: m.promotion } : {}),
      }));
  },

  endIf(state) {
    const pub = state.public;
    if (pub.result === 'white') return { winners: [0] };
    if (pub.result === 'black') return { winners: [1] };
    if (pub.result === 'draw') return { winners: [] };
    return null;
  },

  view(state) {
    return state.public; // chess is fully public
  },

  // A chess turn cannot legally be passed — no 'skip' (plan §4.1).
  disconnectOptions() {
    return ['pause', 'kick'];
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    if (pub.result === null) {
      pub.result = seat === 0 ? 'black' : 'white';
      pub.resultReason = 'resignation (removed)';
    }
  },
};
