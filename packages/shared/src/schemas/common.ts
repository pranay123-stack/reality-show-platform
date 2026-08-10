import { z } from 'zod';

import { PAGINATION } from '../constants';

/** Every id in this system is a cuid produced by Prisma. */
export const idSchema = z.string().min(1).max(64);

/**
 * Schemes a URL may use when it will end up in an `href` or a `src`.
 *
 * `z.string().url()` is not enough on its own: it delegates to the URL
 * constructor, which happily accepts `javascript:alert(1)`,
 * `data:text/html,<script>...` and `vbscript:`. A value that passes `.url()`
 * and is then rendered into an anchor is a stored XSS waiting for a click.
 */
const SAFE_URL_SCHEMES = ['http:', 'https:'];

/**
 * Control characters are exactly what this needs to match: a newline or a NUL
 * inside a link is how header and attribute injection is smuggled past a naive
 * check, so the rule is disabled deliberately rather than worked around.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * An absolute URL that is safe to render.
 *
 * Used for anything a user or operator supplies that the app will link to or
 * load: avatars, media, notification targets.
 */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      try {
        return SAFE_URL_SCHEMES.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: 'Enter a valid http(s) URL' },
  );

/**
 * A link the app will navigate to.
 *
 * Accepts an in-app path (`/polls`) or an absolute http(s) URL, and nothing
 * else. Protocol-relative `//evil.example` is rejected too: it looks like a
 * path and behaves like an absolute URL, which is precisely how open redirects
 * get through review.
 */
export const safeLinkSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      if (CONTROL_CHARACTERS.test(value)) return false;
      if (value.startsWith('//')) return false;
      if (value.startsWith('/')) return true;
      try {
        return SAFE_URL_SCHEMES.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: 'Enter an in-app path such as /polls, or an http(s) URL' },
  );

export const isoDateSchema = z.union([z.string().datetime(), z.date()]);

export const cursorPaginationSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});
export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;

export const idParamSchema = z.object({ id: idSchema });

/**
 * Clients send this on every point-bearing or vote-bearing POST so a retried
 * request (flaky network, double tap) can never be applied twice.
 */
export const idempotencyKeySchema = z.string().min(8).max(128);

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OffsetPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  uptimeSeconds: z.number(),
  version: z.string(),
  timestamp: z.string(),
  dependencies: z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
