import { createAdapter } from '@socket.io/redis-adapter';
import { ERROR_CODES } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';

import { verifyAccessToken } from '../core/auth/jwt.js';
import { resolveSession } from '../core/auth/session-cache.js';
import { getConfig } from '../core/config.js';
import { ACCESS_COOKIE } from '../core/auth/cookies.js';
import { createRedisClient } from '../core/redis.js';
import { castVote, getPollForViewer } from '../modules/polls/polls.service.js';
import { PollBroadcaster } from './broadcaster.js';
import {
  SOCKET_NAMESPACE,
  rooms,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from './events.js';

/**
 * Socket.IO server.
 *
 * Authentication happens once, in the handshake, and the resolved principal is
 * pinned to the socket. An unauthenticated socket is still allowed — spectating
 * a live poll needs no account — but it can only *read*: `poll:vote` requires a
 * verified, active user, checked against server state rather than anything the
 * client asserts.
 */

interface SocketData {
  userId: string | null;
  emailVerified: boolean;
  role: string | null;
}

export type LiveServer = Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

let io: LiveServer | null = null;
let broadcaster: PollBroadcaster | null = null;
let adapterClients: { pub: ReturnType<typeof createRedisClient>; sub: ReturnType<typeof createRedisClient> } | null = null;

export function getIo(): LiveServer | null {
  return io;
}

export function getBroadcaster(): PollBroadcaster | null {
  return broadcaster;
}

function readTokenFromHandshake(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token) return auth.token;

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);

  // Browsers cannot set headers on a WebSocket handshake, so the cookie is the
  // realistic path for a web client.
  const cookie = socket.handshake.headers.cookie;
  if (typeof cookie === 'string') {
    const match = new RegExp(`(?:^|; )${ACCESS_COOKIE}=([^;]*)`).exec(cookie);
    if (match) return decodeURIComponent(match[1]!);
  }

  return null;
}

export async function attachRealtime(app: FastifyInstance): Promise<LiveServer> {
  const config = getConfig();

  io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(app.server, {
    path: '/socket.io',
    cors: { origin: config.corsOrigins, credentials: true },
    // A client that misses two heartbeats is dropped, so a half-open connection
    // does not sit in a room receiving frames nobody reads.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectionStateRecovery: {
      // Lets a client that drops briefly resume its rooms and receive the frames
      // it missed instead of starting cold.
      maxDisconnectionDuration: 2 * 60_000,
      skipMiddlewares: false,
    },
  });

  if (!config.isTest) {
    // The Redis adapter is what makes rooms work across more than one API
    // process. Without it, a vote handled by instance A would never reach a
    // client connected to instance B.
    const pub = createRedisClient();
    const sub = pub.duplicate();
    adapterClients = { pub, sub };
    io.adapter(createAdapter(pub, sub));
  }

  const namespace = io.of(SOCKET_NAMESPACE);
  broadcaster = new PollBroadcaster(namespace);

  namespace.use(async (socket, next) => {
    try {
      const token = readTokenFromHandshake(socket);
      socket.data.userId = null;
      socket.data.emailVerified = false;
      socket.data.role = null;

      if (token) {
        const claims = await verifyAccessToken(token);
        if (claims) {
          const context = await resolveSession(claims.sid);
          // A revoked session or a changed role invalidates the token, exactly
          // as it does over HTTP.
          if (context && context.role === claims.role) {
            socket.data.userId = context.userId;
            socket.data.emailVerified = context.emailVerified;
            socket.data.role = context.role;
          }
        }
      }
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  namespace.on('connection', (socket) => {
    const { userId, role } = socket.data;

    if (userId) {
      void socket.join(rooms.user(userId));
      if (role === 'ADMIN' || role === 'PRODUCER' || role === 'MODERATOR') {
        void socket.join(rooms.admin);
      }
    }

    socket.emit('connection:ready', { userId, serverTime: new Date().toISOString() });

    socket.on('ping', (ack) => {
      if (typeof ack === 'function') ack({ serverTime: new Date().toISOString() });
    });

    socket.on('poll:join', async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => undefined;
      try {
        if (!payload?.pollId) {
          respond({ ok: false, code: ERROR_CODES.BAD_REQUEST, message: 'pollId is required' });
          return;
        }

        await socket.join(rooms.poll(payload.pollId));

        // Joining always returns authoritative state over HTTP-equivalent reads,
        // so a reconnecting client re-syncs rather than trusting cached frames.
        const { poll, myOptionId } = await getPollForViewer(payload.pollId, socket.data.userId);

        // Someone who already voted — including after a reconnect — belongs in
        // the voters' room and is entitled to the live breakdown.
        if (myOptionId || poll.status === 'CLOSED' || poll.status === 'PUBLISHED') {
          await socket.join(rooms.pollVoters(payload.pollId));
        }

        respond({ ok: true, poll, myOptionId });
      } catch (error) {
        respond({
          ok: false,
          code: ERROR_CODES.NOT_FOUND,
          message: error instanceof Error ? error.message : 'Could not join that poll',
        });
      }
    });

    socket.on('poll:leave', (payload) => {
      if (payload?.pollId) void socket.leave(rooms.poll(payload.pollId));
    });

    socket.on('poll:vote', async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => undefined;

      if (!socket.data.userId) {
        respond({ ok: false, code: ERROR_CODES.UNAUTHENTICATED, message: 'Sign in to vote' });
        return;
      }
      if (!socket.data.emailVerified) {
        respond({
          ok: false,
          code: ERROR_CODES.EMAIL_NOT_VERIFIED,
          message: 'Confirm your email address before voting',
        });
        return;
      }
      if (!payload?.pollId || !payload?.optionId) {
        respond({ ok: false, code: ERROR_CODES.BAD_REQUEST, message: 'pollId and optionId are required' });
        return;
      }

      try {
        const result = await castVote(payload.pollId, socket.data.userId, payload.optionId);

        // Having voted, this socket may now see the breakdown.
        await socket.join(rooms.pollVoters(payload.pollId));

        // The voter gets the authoritative tally immediately; everyone else
        // receives it on the next coalesced tick.
        respond({
          ok: true,
          counts: result.counts,
          totalVotes: result.totalVotes,
          version: result.version,
          pointsAwarded: result.pointsAwarded,
        });

        broadcaster?.queue(payload.pollId, {
          counts: result.counts,
          totalVotes: result.totalVotes,
          version: result.version,
        });

        if (result.pointsAwarded > 0) {
          namespace.to(rooms.user(socket.data.userId)).emit('points:awarded', {
            delta: result.pointsAwarded,
            balance: result.balance,
            reason: 'poll',
          });
        }
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : ERROR_CODES.INTERNAL_ERROR;

        respond({
          ok: false,
          code,
          message: error instanceof Error ? error.message : 'Could not record your vote',
        });
      }
    });
  });

  app.addHook('onClose', async () => {
    await shutdownRealtime();
  });

  return io;
}

export async function shutdownRealtime(): Promise<void> {
  broadcaster?.stop();
  broadcaster = null;

  if (io) {
    await new Promise<void>((resolve) => io?.close(() => resolve()));
    io = null;
  }

  if (adapterClients) {
    adapterClients.pub.disconnect();
    adapterClients.sub.disconnect();
    adapterClients = null;
  }
}

/** Namespace-scoped emitter used by the HTTP routes after a lifecycle change. */
export function liveNamespace() {
  return io?.of(SOCKET_NAMESPACE) ?? null;
}
