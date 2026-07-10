import type { Seat, DisconnectOption } from '@gamebox/shared-types';

/**
 * Disconnect-vote state machine (plan §5.3): after a grace period any connected
 * player can call a vote on a disconnected seat. The vote resolves the instant
 * one option secures a strict majority of currently-connected voters; a genuine
 * tie (all voted, evenly split) falls back to 'pause'.
 */
export interface DisconnectVote {
  targetSeat: Seat;
  options: DisconnectOption[];
  votes: Map<Seat, DisconnectOption>;
}

export function createVote(targetSeat: Seat, options: DisconnectOption[]): DisconnectVote {
  return { targetSeat, options, votes: new Map() };
}

export interface VoteOutcome {
  resolved: boolean;
  option: DisconnectOption | null;
}

/**
 * Records a ballot and checks resolution against the set of currently-connected
 * voter seats (excluding the disconnected target).
 */
export function castVote(
  vote: DisconnectVote,
  voter: Seat,
  option: DisconnectOption,
  connectedVoters: Seat[],
): VoteOutcome {
  if (!vote.options.includes(option)) {
    return { resolved: false, option: null };
  }
  vote.votes.set(voter, option);

  const voters = connectedVoters.filter((s) => s !== vote.targetSeat);
  const majorityThreshold = Math.floor(voters.length / 2) + 1;

  const tally = new Map<DisconnectOption, number>();
  for (const [seat, opt] of vote.votes) {
    if (!voters.includes(seat)) continue;
    tally.set(opt, (tally.get(opt) ?? 0) + 1);
  }

  for (const [opt, count] of tally) {
    if (count >= majorityThreshold) {
      return { resolved: true, option: opt };
    }
  }

  // Everyone connected has voted but nothing hit majority → tie → pause.
  const votesFromConnected = voters.filter((s) => vote.votes.has(s)).length;
  if (votesFromConnected >= voters.length && voters.length > 0) {
    return { resolved: true, option: 'pause' };
  }

  return { resolved: false, option: null };
}
