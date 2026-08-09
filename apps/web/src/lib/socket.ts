'use client';

import { io, type Socket } from 'socket.io-client';

import { env } from './env';

/**
 * One shared socket for the whole app.
 *
 * Opening a connection per screen would multiply handshakes and make room
 * membership hard to reason about, so screens join and leave rooms on a single
 * connection instead.
 *
 * The access token travels in an httpOnly cookie, which the browser attaches to
 * the handshake automatically — there is deliberately no token in JavaScript
 * for a script to read.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(`${env.wsUrl}/live`, {
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    // Backs off to 5s rather than hammering a server that is already struggling.
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10_000,
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

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
  counts: PollOptionCount[] | null;
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
