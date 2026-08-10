import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment loading + validation.
 *
 * The whole monorepo shares one root `.env`. The API is started from `apps/api`,
 * so we walk up to the workspace root to find it, then fall back to a local
 * `apps/api/.env` for people who prefer per-app files. Real environments
 * (Docker, CI) inject variables directly and no file is needed.
 */
const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFiles(): void {
  const candidates = [
    resolve(here, '../../../../.env'), // repo root from src/core
    resolve(here, '../../../.env'), // repo root from dist
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
    }
  }
}

loadEnvFiles();

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters'),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: booleanish.optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3010'),
  /// Public base URL of the web app; used to build links inside emails.
  WEB_URL: z.string().url().default('http://localhost:3010'),

  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  POLL_BROADCAST_THROTTLE_MS: z.coerce.number().int().min(50).max(5000).default(250),
  HEAT_RECOMPUTE_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  /// How often the analytics aggregation pass runs. Hourly is ample: the
  /// dashboard describes days, not minutes.
  ANALYTICS_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  LEADERBOARD_CACHE_TTL_S: z.coerce.number().int().min(5).default(60),
  /// The timezone that defines a leaderboard's day and week boundaries. Not the
  /// server's zone and not the viewer's: a shared ranking needs one agreed
  /// boundary, or two people in different zones sit on different boards and the
  /// numbers stop being comparable.
  LEADERBOARD_TIMEZONE: z.string().min(1).default('UTC'),
  /// How far back the projector re-reads the ledger on each pass. Concurrent
  /// inserts can commit out of order, so a strict watermark would skip rows;
  /// the overlap plus per-entry idempotency closes that gap.
  LEADERBOARD_OVERLAP_S: z.coerce.number().int().min(5).default(120),

  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('no-reply@reality.local'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  OTP_DRIVER: z.enum(['console', 'sms']).default('console'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema> & {
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
  corsOrigins: string[];
  version: string;
};

function build(): AppConfig {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env (\`pnpm setup:env\`) and fill in the values.`,
    );
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  // Dev placeholders must never reach production.
  if (isProduction) {
    const weak = (
      [
        ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
        ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
        ['COOKIE_SECRET', env.COOKIE_SECRET],
      ] as const
    ).filter(([, value]) => value.includes('change-me') || value.startsWith('dev-'));

    if (weak.length > 0) {
      throw new Error(
        `Refusing to start in production with development placeholder secrets: ${weak
          .map(([name]) => name)
          .join(', ')}`,
      );
    }
  }

  return {
    ...env,
    isProduction,
    isTest: env.NODE_ENV === 'test',
    isDevelopment: env.NODE_ENV === 'development',
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    version: process.env.npm_package_version ?? '0.1.0',
  };
}

let cached: AppConfig | null = null;

/** Lazily built and memoised so importing this module never throws at load time. */
export function getConfig(): AppConfig {
  cached ??= build();
  return cached;
}

/** Test helper: forces the next `getConfig()` call to re-read `process.env`. */
export function resetConfigCache(): void {
  cached = null;
}
