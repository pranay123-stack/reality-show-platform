import { ERROR_CODES } from '@reality/shared';
import type { Socket } from 'socket.io';

import { resolveSession } from '../core/auth/session-cache.js';
import { redis } from '../core/redis.js';

/**
 * Socket-side authorisation.
 *
 * ### Why the handshake is not enough
 *
 * A socket authenticates once and then lives for hours. Everything decided at
 * the handshake — the account's status, its role, whether the session was
 * revoked — is a snapshot that goes stale the moment a moderator acts. Before
 * this, suspending an account mid-show left its open socket voting and earning
 * points until the user chose to reconnect, which is exactly the moment they
 * never will.
 *
 * So every privileged event re-resolves the principal. `resolveSession` is
 * Redis-cached for 30 seconds, so the cost is a cache read and the exposure
 * window matches HTTP's rather than being unbounded.
 */

export interface LivePrincipal {
  userId: string;
  role: string;
  emailVerified: boolean;
  status: string;
}

export type PrincipalResult =
  | { ok: true; principal: LivePrincipal }
  | { ok: false; code: string; message: string };

/**
 * Re-reads the principal behind a socket.
 *
 * Returns a refusal rather than throwing, because a socket handler answers with
 * an ack and has no error funnel behind it.
 */
export async function currentPrincipal(socket: Socket): Promise<PrincipalResult> {
  const sessionId = socket.data.sessionId as string | undefined;

  if (!sessionId) {
    return { ok: false, code: ERROR_CODES.UNAUTHENTICATED, message: 'Sign in to do that' };
  }

  const context = await resolveSession(sessionId);
  if (!context) {
    return {
      ok: false,
      code: ERROR_CODES.SESSION_REVOKED,
      message: 'Your session is no longer valid. Sign in again.',
    };
  }

  // A role change invalidates the socket exactly as it invalidates a token.
  if (socket.data.role && context.role !== socket.data.role) {
    return {
      ok: false,
      code: ERROR_CODES.SESSION_REVOKED,
      message: 'Your access level changed. Sign in again.',
    };
  }

  if (context.status !== 'ACTIVE') {
    return {
      ok: false,
      code: ERROR_CODES.ACCOUNT_SUSPENDED,
      message: 'Your account cannot take part right now',
    };
  }

  if (!context.emailVerified) {
    return {
      ok: false,
      code: ERROR_CODES.EMAIL_NOT_VERIFIED,
      message: 'Confirm your email address before taking part',
    };
  }

  return {
    ok: true,
    principal: {
      userId: context.userId,
      role: context.role,
      emailVerified: context.emailVerified,
      status: context.status,
    },
  };
}

/**
 * Per-socket event rate limiting.
 *
 * HTTP routes are rate limited; socket events were not, so an unauthenticated
 * client could issue `poll:join` as fast as the network allowed and each one
 * cost a database read. The limiter is keyed on the connection rather than the
 * account, because the events worth flooding are the ones that need no account.
 *
 * Redis-backed so the budget is shared across API instances; a Redis outage
 * degrades to allowing the event rather than dropping legitimate traffic.
 */
const WINDOW_SECONDS = 10;

export interface RateLimitRule {
  event: string;
  max: number;
}

export async function withinRateLimit(
  socket: Socket,
  rule: RateLimitRule,
): Promise<boolean> {
  const key = `ws:rl:${rule.event}:${socket.id}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS);
    return count <= rule.max;
  } catch {
    // The limiter is a safeguard, not a gate: if Redis is unreachable the show
    // still has to work.
    return true;
  }
}

export const RATE_LIMITS = {
  /** Joining is cheap but hits the database, so it is capped generously. */
  join: { event: 'poll:join', max: 20 } satisfies RateLimitRule,
  /** One vote per poll is the real limit; this only stops a flood. */
  vote: { event: 'poll:vote', max: 10 } satisfies RateLimitRule,
} as const;

export const RATE_LIMITED_MESSAGE = 'You are doing that too quickly. Slow down.';
