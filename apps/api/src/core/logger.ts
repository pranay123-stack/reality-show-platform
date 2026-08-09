import type { FastifyServerOptions } from 'fastify';
import pino, { type Logger } from 'pino';

import { getConfig } from './config.js';

/**
 * Fields that must never reach the logs, at any depth Fastify serialises.
 * Pino redaction is a backstop; the primary defence is simply not logging bodies.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
];

export function buildLoggerOptions(): FastifyServerOptions['logger'] {
  const config = getConfig();

  if (config.isTest) {
    return false;
  }

  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    // Request bodies are deliberately not serialised — they carry credentials.
    serializers: {
      req(request: {
        method: string;
        url: string;
        id: string;
        ip?: string;
        headers?: Record<string, unknown>;
      }) {
        return {
          id: request.id,
          method: request.method,
          url: request.url,
          userAgent: request.headers?.['user-agent'],
        };
      },
      res(reply: { statusCode: number }) {
        return { statusCode: reply.statusCode };
      },
    },
    ...(config.isDevelopment
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

/**
 * A logger for work that happens outside a request.
 *
 * Background jobs — the leaderboard projection, scheduled rebuilds — have no
 * `request.log` to write to, and swallowing their failures silently is how a
 * cache quietly stops updating for a week. Test runs stay silent so a
 * deliberately provoked failure does not bury the assertion output.
 */
export const logger: Logger = pino({
  level: getConfig().isTest ? 'silent' : getConfig().LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
});
