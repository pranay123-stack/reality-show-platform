import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ERROR_CODES } from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import { CSRF_HEADER } from './auth/cookies.js';
import { getConfig } from './config.js';
import { redis } from './redis.js';

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
    allowList: (request) => request.url === '/health' || request.url === '/ready',
    errorResponseBuilder(_request, context) {
      return {
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: `Too many requests. Try again in ${context.after}.`,
        },
      };
    },
  });
}
