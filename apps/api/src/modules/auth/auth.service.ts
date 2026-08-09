import {
  ERROR_CODES,
  type AuthUser,
  type ForgotPasswordInput,
  type LoginInput,
  type SessionSummary,
  type SignupInput,
} from '@reality/shared';

import { getConfig } from '../../core/config.js';
import { clearAuthCookies } from '../../core/auth/cookies.js';
import { parseDuration, signAccessToken } from '../../core/auth/jwt.js';
import {
  invalidateSessionCache,
  invalidateUserSessions,
} from '../../core/auth/session-cache.js';
import { AppError, conflict, notFound, unauthenticated } from '../../core/errors.js';
import { deviceHash, hashIp, randomToken, sha256 } from '../../core/hashing.js';
import {
  getMailer,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../../core/mailer.js';
import { hashPassword, needsRehash, verifyPassword } from '../../core/password.js';
import { permissionsForRole } from '../../core/permissions.js';
import { prisma } from '../../core/prisma.js';
import {
  LOGIN_IP_POLICY,
  LOGIN_POLICY,
  SENSITIVE_ACTION_POLICY,
  clearFailures,
  getThrottleState,
  recordFailure,
  secondsUntil,
} from '../../core/throttle.js';
import {
  recordEmailAliasSignal,
  registerDeviceAndDetect,
} from './duplicate-detection.js';
import { normalizeEmail } from './email-normalization.js';

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  acceptLanguage?: string;
}

export interface AuthSuccess {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  rememberMe: boolean;
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export async function signup(input: SignupInput, meta: RequestMeta): Promise<AuthSuccess> {
  const email = input.email.trim().toLowerCase();
  const emailNormalized = normalizeEmail(email);

  // Layer 1: the canonical address is what actually has to be unique, so an
  // alias of an existing address is rejected before anything is written.
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { emailNormalized }] },
    select: { id: true, email: true },
  });

  if (existing) {
    // Identical wording whether the collision was on the literal address or on
    // its canonical form, so the response does not teach an attacker which.
    throw conflict(ERROR_CODES.EMAIL_TAKEN, 'An account already exists for this email address');
  }

  const displayNameTaken = await prisma.userProfile.findFirst({
    where: { displayName: input.displayName },
    select: { id: true },
  });
  if (displayNameTaken) {
    throw conflict(ERROR_CODES.CONFLICT, 'That display name is already taken');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email,
      emailNormalized,
      passwordHash,
      status: 'PENDING_VERIFICATION',
      profile: { create: { displayName: input.displayName } },
    },
    include: { profile: true },
  });

  // Layer 3 (advisory): record the device and raise a signal if it has produced
  // other accounts. This never blocks the signup.
  const device = deviceHash({
    userAgent: meta.userAgent,
    acceptLanguage: meta.acceptLanguage,
    ip: meta.ip,
  });
  await registerDeviceAndDetect(user.id, {
    deviceHash: device,
    userAgent: meta.userAgent,
    ipHash: hashIp(meta.ip),
  });

  if (email !== emailNormalized) {
    const canonicalOwner = await prisma.user.findFirst({
      where: { emailNormalized, id: { not: user.id } },
      select: { id: true },
    });
    if (canonicalOwner) {
      await recordEmailAliasSignal(user.id, canonicalOwner.id, email);
    }
  }

  await sendVerificationEmail(user.id, user.email);

  const session = await createSession(user.id, meta, false);
  const { token: accessToken, expiresIn } = await signAccessToken({
    userId: user.id,
    sessionId: session.id,
    role: user.role,
  });

  return {
    user: toAuthUser({ ...user, profile: user.profile }),
    accessToken,
    refreshToken: session.refreshToken,
    csrfToken: session.csrfToken,
    expiresIn,
    rememberMe: false,
  };
}

// ---------------------------------------------------------------------------
// Log in
// ---------------------------------------------------------------------------

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthSuccess> {
  const email = input.email.trim().toLowerCase();
  const emailNormalized = normalizeEmail(email);
  const ipScope = `login:ip:${hashIp(meta.ip) ?? 'unknown'}`;
  const accountScope = `login:acct:${emailNormalized}`;

  await assertNotLockedOut(accountScope);
  await assertNotLockedOut(ipScope);

  const user = await prisma.user.findFirst({
    where: { emailNormalized },
    include: { profile: true },
  });

  // Identical error for "no such user" and "wrong password" so the endpoint
  // cannot be used to enumerate registered addresses.
  const invalid = new AppError({
    code: ERROR_CODES.INVALID_CREDENTIALS,
    message: 'Email or password is incorrect',
    statusCode: 401,
  });

  if (!user || user.deletedAt) {
    await recordFailure(ipScope, LOGIN_IP_POLICY);
    throw invalid;
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    await Promise.all([
      recordFailure(accountScope, LOGIN_POLICY),
      recordFailure(ipScope, LOGIN_IP_POLICY),
    ]);
    throw invalid;
  }

  if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
    throw new AppError({
      code: ERROR_CODES.ACCOUNT_SUSPENDED,
      message:
        user.status === 'BANNED'
          ? 'This account has been closed.'
          : 'This account is suspended. Contact support if you think this is a mistake.',
      statusCode: 403,
    });
  }

  await Promise.all([clearFailures(accountScope), clearFailures(ipScope)]);

  // Transparently upgrade the stored hash if the cost parameters have been raised.
  if (needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(input.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
  }

  const session = await createSession(user.id, meta, input.rememberMe ?? false);
  const { token: accessToken, expiresIn } = await signAccessToken({
    userId: user.id,
    sessionId: session.id,
    role: user.role,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    user: toAuthUser(user),
    accessToken,
    refreshToken: session.refreshToken,
    csrfToken: session.csrfToken,
    expiresIn,
    rememberMe: input.rememberMe ?? false,
  };
}

async function assertNotLockedOut(scope: string): Promise<void> {
  const state = await getThrottleState(scope);
  if (state.lockedUntil) {
    throw new AppError({
      code: ERROR_CODES.RATE_LIMITED,
      message: `Too many failed attempts. Try again in ${secondsUntil(state.lockedUntil)} seconds.`,
      statusCode: 429,
    });
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface CreatedSession {
  id: string;
  refreshToken: string;
  csrfToken: string;
}

async function createSession(
  userId: string,
  meta: RequestMeta,
  rememberMe: boolean,
): Promise<CreatedSession> {
  const config = getConfig();
  const refreshToken = randomToken(32);
  const ttlSeconds = rememberMe ? parseDuration(config.JWT_REFRESH_TTL) : parseDuration('1d');

  const device = deviceHash({
    userAgent: meta.userAgent,
    acceptLanguage: meta.acceptLanguage,
    ip: meta.ip,
  });

  const deviceRecord = await prisma.userDevice.upsert({
    where: { userId_deviceHash: { userId, deviceHash: device } },
    update: { lastSeenAt: new Date(), userAgent: meta.userAgent },
    create: { userId, deviceHash: device, userAgent: meta.userAgent },
  });

  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      userAgent: meta.userAgent?.slice(0, 400),
      ipHash: hashIp(meta.ip),
      deviceId: deviceRecord.id,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
  });

  // CSRF token is a plain random hex value; it only needs to be unguessable and
  // comparable, never secret from the page that owns it.
  return { id: session.id, refreshToken, csrfToken: sha256(randomToken(16)) };
}

/**
 * Refresh with rotation: the presented token is consumed and a new one issued.
 * Re-presenting a consumed token is treated as theft and kills the whole
 * session family.
 */
export async function refresh(
  presentedToken: string,
  meta: RequestMeta,
): Promise<AuthSuccess> {
  const hash = sha256(presentedToken);
  const session = await prisma.userSession.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: { include: { profile: true } } },
  });

  if (!session) {
    // The token did not match the current one. If it matches the hash this
    // session already rotated away from, it was captured and replayed — the
    // legitimate holder has a newer token, so two parties hold credentials for
    // one session. Destroy the whole family; a forced sign-in is a far smaller
    // cost than letting an attacker ride along.
    const replayed = await prisma.userSession.findUnique({
      where: { previousTokenHash: hash },
      select: { userId: true },
    });

    if (replayed) {
      await revokeAllSessions(replayed.userId);
      throw new AppError({
        code: ERROR_CODES.SESSION_REVOKED,
        message: 'Your session was ended for security reasons. Sign in again.',
        statusCode: 401,
      });
    }

    throw unauthenticated('Your session has expired. Sign in again.');
  }

  if (session.revokedAt) {
    // A revoked token being presented again means it leaked. Revoke everything.
    await revokeAllSessions(session.userId);
    throw new AppError({
      code: ERROR_CODES.SESSION_REVOKED,
      message: 'Your session was ended for security reasons. Sign in again.',
      statusCode: 401,
    });
  }

  if (session.expiresAt <= new Date()) {
    throw new AppError({
      code: ERROR_CODES.TOKEN_EXPIRED,
      message: 'Your session has expired. Sign in again.',
      statusCode: 401,
    });
  }

  const user = session.user;
  if (!user || user.deletedAt || user.status === 'BANNED' || user.status === 'SUSPENDED') {
    await revokeSessionById(session.id);
    throw new AppError({
      code: ERROR_CODES.ACCOUNT_SUSPENDED,
      message: 'This account cannot sign in right now.',
      statusCode: 403,
    });
  }

  const newRefreshToken = randomToken(32);
  await prisma.userSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: sha256(newRefreshToken),
      previousTokenHash: hash,
      lastSeenAt: new Date(),
      ipHash: hashIp(meta.ip),
    },
  });

  const { token: accessToken, expiresIn } = await signAccessToken({
    userId: user.id,
    sessionId: session.id,
    role: user.role,
  });

  return {
    user: toAuthUser(user),
    accessToken,
    refreshToken: newRefreshToken,
    csrfToken: sha256(randomToken(16)),
    expiresIn,
    rememberMe: session.expiresAt.getTime() - session.createdAt.getTime() > 2 * 86_400_000,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSessionById(sessionId);
}

async function revokeSessionById(sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await invalidateSessionCache(sessionId);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  await invalidateUserSessions(userId);
  const result = await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function listSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionSummary[]> {
  const sessions = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    take: 50,
  });

  return sessions.map((session) => ({
    id: session.id,
    current: session.id === currentSessionId,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!session || session.userId !== userId) throw notFound('Session not found');
  await revokeSessionById(sessionId);
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = randomToken(32);

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    },
  });

  const link = `${getConfig().WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await getMailer().send(verificationEmail(email, link));
}

export async function verifyEmail(token: string): Promise<AuthUser> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { profile: true } } },
  });

  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw new AppError({
      code: ERROR_CODES.TOKEN_INVALID,
      message: 'This verification link is invalid or has expired. Request a new one.',
      statusCode: 400,
    });
  }

  const [, user] = await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        emailVerifiedAt: new Date(),
        status: record.user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : record.user.status,
      },
      include: { profile: true },
    }),
  ]);

  await invalidateUserSessions(user.id);
  return toAuthUser(user);
}

/**
 * Always reports success. Telling an anonymous caller whether an address is
 * registered is an enumeration oracle, and this endpoint does not need to.
 */
export async function resendVerification(email: string): Promise<void> {
  const scope = `verify:resend:${normalizeEmail(email)}`;
  const state = await getThrottleState(scope);
  if (state.lockedUntil) return;
  await recordFailure(scope, SENSITIVE_ACTION_POLICY);

  const user = await prisma.user.findFirst({
    where: { emailNormalized: normalizeEmail(email), deletedAt: null },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  if (!user || user.emailVerifiedAt) return;
  await sendVerificationEmail(user.id, user.email);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function forgotPassword(
  input: ForgotPasswordInput,
  meta: RequestMeta,
): Promise<void> {
  const emailNormalized = normalizeEmail(input.email);
  const scope = `reset:request:${emailNormalized}`;

  const state = await getThrottleState(scope);
  if (state.lockedUntil) return; // silently ignore; still a 200 to the caller
  await recordFailure(scope, SENSITIVE_ACTION_POLICY);

  const user = await prisma.user.findFirst({
    where: { emailNormalized, deletedAt: null },
    select: { id: true, email: true, status: true },
  });

  if (!user || user.status === 'BANNED') return;

  const token = randomToken(32);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      requestIp: hashIp(meta.ip),
    },
  });

  const link = `${getConfig().WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await getMailer().send(passwordResetEmail(user.email, link));
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true } } },
  });

  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw new AppError({
      code: ERROR_CODES.TOKEN_INVALID,
      message: 'This reset link is invalid or has expired. Request a new one.',
      statusCode: 400,
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    // Every other reset token for this user is burned too.
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  // A password reset must end every existing session — that is the point of it.
  await revokeAllSessions(record.userId);
  await clearFailures(`login:acct:${normalizeEmail(record.user.email)}`);
  await getMailer().send(passwordChangedEmail(record.user.email));
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true },
  });

  const scope = `password:change:${userId}`;
  await assertNotLockedOut(scope);

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    await recordFailure(scope, SENSITIVE_ACTION_POLICY);
    throw new AppError({
      code: ERROR_CODES.INVALID_CREDENTIALS,
      message: 'Your current password is incorrect',
      statusCode: 400,
    });
  }

  await clearFailures(scope);
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Keep the session that made the change; end all the others.
  await revokeAllSessions(userId, currentSessionId);
  await getMailer().send(passwordChangedEmail(user.email));
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

export async function getCurrentUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user || user.deletedAt) throw notFound('Account not found');
  return toAuthUser(user);
}

type UserWithProfile = {
  id: string;
  email: string;
  role: AuthUser['role'];
  status: AuthUser['status'];
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
  profile: {
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    country: string | null;
    timezone: string;
    pointsBalance: number;
    lifetimePoints: number;
  } | null;
};

export function toAuthUser(user: UserWithProfile): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
    displayName: user.profile?.displayName ?? 'Viewer',
    avatarUrl: user.profile?.avatarUrl ?? null,
    bio: user.profile?.bio ?? null,
    country: user.profile?.country ?? null,
    timezone: user.profile?.timezone ?? 'UTC',
    pointsBalance: user.profile?.pointsBalance ?? 0,
    lifetimePoints: user.profile?.lifetimePoints ?? 0,
    createdAt: user.createdAt.toISOString(),
    permissions: permissionsForRole(user.role),
  };
}

export { clearAuthCookies };
