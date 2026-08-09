import type { Role, UserStatus } from '@reality/shared';

import { prisma } from '../prisma.js';
import { permissionsForRole, type PermissionKey } from '../permissions.js';
import { redis } from '../redis.js';
import type { AuthContext } from './context.js';

/**
 * Per-request principal lookup.
 *
 * A JWT proves *who* signed in; it cannot prove the session is still valid, the
 * account is still active, or the role has not changed. Those need server state,
 * so every request resolves the session — cached in Redis for a short TTL to keep
 * the cost near zero while bounding how long a revoked session can linger.
 */
const CACHE_TTL_SECONDS = 30;
const cacheKey = (sessionId: string) => `session:${sessionId}`;

interface CachedSession {
  userId: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
}

export async function resolveSession(sessionId: string): Promise<AuthContext | null> {
  const cached = await readCache(sessionId);
  if (cached) {
    return toContext(sessionId, cached);
  }

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: {
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (!session.user || session.user.deletedAt) return null;
  if (session.user.status === 'BANNED' || session.user.status === 'SUSPENDED') return null;

  const snapshot: CachedSession = {
    userId: session.user.id,
    role: session.user.role,
    status: session.user.status,
    emailVerified: session.user.emailVerifiedAt !== null,
  };

  await writeCache(sessionId, snapshot);
  return toContext(sessionId, snapshot);
}

function toContext(sessionId: string, snapshot: CachedSession): AuthContext {
  return {
    userId: snapshot.userId,
    sessionId,
    role: snapshot.role,
    status: snapshot.status,
    emailVerified: snapshot.emailVerified,
    permissions: permissionsForRole(snapshot.role) as PermissionKey[],
  };
}

async function readCache(sessionId: string): Promise<CachedSession | null> {
  try {
    const raw = await redis.get(cacheKey(sessionId));
    return raw ? (JSON.parse(raw) as CachedSession) : null;
  } catch {
    // A Redis outage must degrade to a database read, not a failed request.
    return null;
  }
}

async function writeCache(sessionId: string, snapshot: CachedSession): Promise<void> {
  try {
    await redis.set(cacheKey(sessionId), JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
  } catch {
    /* cache is best-effort */
  }
}

/** Called on logout, password change, role change and admin suspension. */
export async function invalidateSessionCache(sessionId: string): Promise<void> {
  try {
    await redis.del(cacheKey(sessionId));
  } catch {
    /* the short TTL bounds the staleness anyway */
  }
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  const sessions = await prisma.userSession.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  await Promise.all(sessions.map((session) => invalidateSessionCache(session.id)));
}
