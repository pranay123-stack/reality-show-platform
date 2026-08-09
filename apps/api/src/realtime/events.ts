/**
 * The realtime contract.
 *
 * Two rules hold across every event here:
 *
 *  1. **The server is the only source of counts.** Clients send intents
 *     (`poll:vote`), never tallies. Nothing a client sends is ever echoed back
 *     as truth.
 *  2. **Every stateful frame carries a `version`.** Sockets can deliver frames
 *     out of order after a reconnect or a slow network; clients drop any frame
 *     whose version is not greater than the last one they applied.
 */

export const SOCKET_NAMESPACE = '/live';

export interface PollOptionCount {
  optionId: string;
  voteCount: number;
}

export interface PollSnapshot {
  id: string;
  question: string;
  description: string | null;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  durationSeconds: number | null;
  totalVotes: number;
  version: number;
  options: { id: string; label: string; contestantName: string | null; sortOrder: number }[];
  /** Counts are omitted while a poll is live and the viewer has not voted. */
  counts: PollOptionCount[] | null;
}

export interface ServerToClientEvents {
  'connection:ready': (payload: { userId: string | null; serverTime: string }) => void;
  'show:state': (payload: {
    showId: string;
    isLive: boolean;
    currentEpisodeId: string | null;
  }) => void;

  'poll:started': (payload: { poll: PollSnapshot }) => void;
  'poll:updated': (payload: {
    pollId: string;
    /**
     * Null for clients that have not voted yet. The per-option split is only
     * ever sent to the voters' room — withholding it in the UI alone would put
     * the tally on the wire for anyone with developer tools open.
     */
    counts: PollOptionCount[] | null;
    totalVotes: number;
    version: number;
  }) => void;
  'poll:paused': (payload: { pollId: string; version: number }) => void;
  'poll:closed': (payload: { pollId: string; closedAt: string; version: number }) => void;
  'poll:result': (payload: {
    pollId: string;
    counts: PollOptionCount[];
    totalVotes: number;
    winningOptionId: string | null;
    version: number;
  }) => void;

  'points:awarded': (payload: { delta: number; balance: number; reason: string }) => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface VoteAck {
  ok: boolean;
  code?: string;
  message?: string;
  counts?: PollOptionCount[];
  totalVotes?: number;
  version?: number;
  pointsAwarded?: number;
}

export interface JoinAck {
  ok: boolean;
  poll?: PollSnapshot;
  myOptionId?: string | null;
  code?: string;
  message?: string;
}

export interface ClientToServerEvents {
  'poll:join': (payload: { pollId: string }, ack: (response: JoinAck) => void) => void;
  'poll:leave': (payload: { pollId: string }) => void;
  'poll:vote': (
    payload: { pollId: string; optionId: string },
    ack: (response: VoteAck) => void,
  ) => void;
  ping: (ack: (response: { serverTime: string }) => void) => void;
}

export const rooms = {
  show: (showId: string) => `show:${showId}`,
  /** Everyone watching a poll. Receives totals, never the per-option split. */
  poll: (pollId: string) => `poll:${pollId}`,
  /** Only clients that have already voted. Receives the full breakdown. */
  pollVoters: (pollId: string) => `poll:${pollId}:voters`,
  user: (userId: string) => `user:${userId}`,
  admin: 'admin',
} as const;
