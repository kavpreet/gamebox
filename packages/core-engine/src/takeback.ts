import type { Seat } from '@gamebox/shared-types';

/**
 * Take-back votes — "wait, I miscounted, can I redo that?"
 *
 * Every physical board allows this and no digital one does, which is a real
 * part of why they feel different: a misclick is permanent in a way a
 * mis-placed counter never is. The safeguard is the same as at a real table —
 * the rest of the players have to agree.
 *
 * Deliberately separate from the disconnect vote rather than a generalisation
 * of it: that one resolves on a *majority for one of several options* against
 * a changing set of connected voters, this one is a single yes/no where a
 * single objection is enough. Forcing them into one shape would make both
 * harder to read.
 */
export interface TakebackVote {
  /** Who asked, and therefore whose move is being unwound. */
  requestedBy: Seat;
  /** The seq the game will return to if this passes. */
  toSeq: number;
  /** Seats entitled to vote (everyone else who is connected and playing). */
  voters: Seat[];
  ballots: Map<Seat, boolean>;
}

export function createTakebackVote(requestedBy: Seat, toSeq: number, voters: Seat[]): TakebackVote {
  return {
    requestedBy,
    toSeq,
    voters: voters.filter((s) => s !== requestedBy),
    ballots: new Map(),
  };
}

export interface TakebackOutcome {
  resolved: boolean;
  approved: boolean;
}

/**
 * Records a ballot. Unanimity among the other players is required: one "no"
 * settles it immediately, which is exactly how it goes at a table — anyone can
 * say "no, you already moved". A request with no other players to ask (a
 * one-opponent game where they have dropped out) passes on its own.
 */
export function castTakebackVote(
  vote: TakebackVote,
  voter: Seat,
  approve: boolean,
): TakebackOutcome {
  if (voter === vote.requestedBy || !vote.voters.includes(voter)) {
    return { resolved: false, approved: false };
  }
  vote.ballots.set(voter, approve);

  if (!approve) return { resolved: true, approved: false };
  const yes = vote.voters.filter((s) => vote.ballots.get(s) === true).length;
  if (yes >= vote.voters.length) return { resolved: true, approved: true };
  return { resolved: false, approved: false };
}

/** True when nobody is left to ask. */
export function isUncontested(vote: TakebackVote): boolean {
  return vote.voters.length === 0;
}
