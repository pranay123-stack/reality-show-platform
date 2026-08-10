import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ERROR_CODES } from '@reality/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ACCESS_COOKIE, CSRF_HEADER } from './auth/cookies.js';
import { AppError } from './errors.js';
import { verifyAccessToken } from './auth/jwt.js';
import { getConfig } from './config.js';
import { redis } from './redis.js';

/** Verified identity for rate limiting only; authorisation happens later. */
async function claimsFor(request: FastifyRequest) {
  const header = request.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  // `request.cookies` is populated by @fastify/cookie, which is registered
  // before the limiter.
  const token = bearer || request.cookies?.[ACCESS_COOKIE];
  if (!token) return null;
  return verifyAccessToken(token);
}

/**
 * Cross-cutting HTTP plugins. Order matters: security headers first, then CORS,
 * then cookies (auth reads them), then the global rate limiter.
 */
export async function registerCorePlugins(
  app: FastifyInstance,
  options: { rateLimit?: boolean } = {},
): Promise<void> {
  const config = getConfig();

  await app.register(helmet, {
    contentSecurityPolicy: false, // the API serves JSON only; the web app owns its CSP
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Same-origin/server-to-server requests carry no Origin header.
      if (!origin) return callback(null, true);
      callback(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // CSRF_HEADER must be here or the browser blocks every cross-origin write
    // at the preflight, before the request is ever sent.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Requested-With',
      CSRF_HEADER,
    ],
    maxAge: 86_400,
  });

  await app.register(cookie, {
    secret: config.COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE ?? config.isProduction,
      path: '/',
    },
  });

  // Tests opt out: a shared limiter across a suite would make unrelated cases
  // fail each other. Rate-limit behaviour has its own dedicated tests.
  if (options.rateLimit === false) return;

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    // Redis keeps limits consistent across API instances; if it is down the
    // plugin falls back to its in-process store rather than failing requests.
    redis: config.isTest ? undefined : redis,
    nameSpace: 'rl:global:',
    /**
     * Signed-in traffic is limited per account, anonymous traffic per address.
     *
     * Keying purely on the address fails in both directions: a university or a
     * mobile carrier behind one NAT is throttled collectively, while an attacker
     * who can rotate addresses is not throttled at all. The account is the thing
     * that has to be limited for an authenticated abuser.
     *
     * The token is *verified* here rather than trusted, because an unverified
     * claim would let an attacker pick which bucket to spend — including
     * somebody else's. This runs on `onRequest`, before `authenticate` has
     * populated `request.auth`, so the work cannot be shared with it.
     */
    async keyGenerator(request) {
      const claims = await claimsFor(request);
      return claims ? `u:${claims.sub}` : `ip:${request.ip}`;
    },
    allowList: (request) => request.url === '/health' || request.url === '/ready',
    /**
     * The limiter *throws* whatever this returns, so it has to be an error the
     * funnel understands. Returning a bare envelope produced a 500 with an
     * INTERNAL_ERROR code — the limit was enforced, but every throttled client
     * was told the server had broken rather than that it should slow down, and
     * no `RATE_LIMITED` code ever reached the web app's error handling.
     */
    errorResponseBuilder(_request, context) {
      return new AppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: `Too many requests. Try again in ${context.after}.`,
        statusCode: 429,
      });
    },
  });
}
