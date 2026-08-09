import { ERROR_CODES, roleAtLeast, type Role } from '@reality/shared';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import { AppError, forbidden, unauthenticated } from '../errors.js';
import { safeEqualHex } from '../hashing.js';
import type { PermissionKey } from '../permissions.js';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './cookies.js';
import { verifyAccessToken } from './jwt.js';
import { resolveSession } from './session-cache.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function extractToken(request: FastifyRequest): { token: string; fromCookie: boolean } | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return { token, fromCookie: false };
  }

  const cookie = request.cookies?.[ACCESS_COOKIE];
  if (cookie) return { token: cookie, fromCookie: true };

  return null;
}

/**
 * Double-submit CSRF check.
 *
 * Only cookie-authenticated unsafe requests need it: a `Authorization: Bearer`
 * request cannot be forged by another origin, because the browser will not
 * attach the header for it.
 */
function assertCsrf(request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return;

  const cookieToken = request.cookies?.[CSRF_COOKIE];
  const headerToken = request.headers[CSRF_HEADER];

  if (!cookieToken || typeof headerToken !== 'string' || !headerToken) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Missing CSRF token',
      statusCode: 403,
    });
  }

  if (!safeEqualHex(cookieToken, headerToken)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Invalid CSRF token',
      statusCode: 403,
    });
  }
}

/**
 * Populates `request.auth`. Rejects with 401 for a missing/invalid token and a
 * revoked, expired, suspended or deleted session.
 */
export const authenticate: preHandlerHookHandler = async (request: FastifyRequest) => {
  const extracted = extractToken(request);
  if (!extracted) throw unauthenticated();

  const claims = await verifyAccessToken(extracted.token);
  if (!claims) {
    throw new AppError({
      code: ERROR_CODES.TOKEN_INVALID,
      message: 'Your session has expired. Sign in again.',
      statusCode: 401,
    });
  }

  if (extracted.fromCookie) assertCsrf(request);

  const context = await resolveSession(claims.sid);
  if (!context) {
    throw new AppError({
      code: ERROR_CODES.SESSION_REVOKED,
      message: 'Your session is no longer valid. Sign in again.',
      statusCode: 401,
    });
  }

  // A rotated role invalidates a token minted under the old one.
  if (context.role !== claims.role) {
    throw new AppError({
      code: ERROR_CODES.SESSION_REVOKED,
      message: 'Your access level changed. Sign in again.',
      statusCode: 401,
    });
  }

  request.auth = context;
};

/** Attaches `request.auth` when a valid token is present, but never rejects. */
export const optionalAuthenticate: preHandlerHookHandler = async (request: FastifyRequest) => {
  const extracted = extractToken(request);
  if (!extracted) return;

  const claims = await verifyAccessToken(extracted.token);
  if (!claims) return;

  const context = await resolveSession(claims.sid);
  if (context && context.role === claims.role) {
    request.auth = context;
  }
};

export function requireAuth(request: FastifyRequest) {
  if (!request.auth) throw unauthenticated();
  return request.auth;
}

/** Role gate. Higher roles inherit every lower role's access. */
export function requireRole(minimum: Role): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const auth = requireAuth(request);
    if (!roleAtLeast(auth.role, minimum)) {
      throw forbidden('You do not have permission to do that');
    }
  };
}

/** Fine-grained gate for a specific operator capability. */
export function requirePermission(permission: PermissionKey): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const auth = requireAuth(request);
    if (!auth.permissions.includes(permission)) {
      throw forbidden('You do not have permission to do that');
    }
  };
}

/**
 * Participation gate. Reading is open to any signed-in user; taking part in a
 * vote, prediction or submission requires a verified email, which is one of the
 * layers that stops one person running several accounts.
 */
export const requireVerifiedEmail: preHandlerHookHandler = async (request: FastifyRequest) => {
  const auth = requireAuth(request);
  if (!auth.emailVerified) {
    throw new AppError({
      code: ERROR_CODES.EMAIL_NOT_VERIFIED,
      message: 'Confirm your email address before taking part',
      statusCode: 403,
    });
  }
  if (auth.status !== 'ACTIVE') {
    throw new AppError({
      code: ERROR_CODES.ACCOUNT_SUSPENDED,
      message: 'Your account cannot take part right now',
      statusCode: 403,
    });
  }
};

/** Composes guards into the single `preHandler` array a route declares. */
export function protectedRoute(...guards: preHandlerHookHandler[]): preHandlerHookHandler[] {
  return [authenticate, ...guards];
}
