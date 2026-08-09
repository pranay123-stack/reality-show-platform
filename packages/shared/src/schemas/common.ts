import { z } from 'zod';

import { PAGINATION } from '../constants';

/** Every id in this system is a cuid produced by Prisma. */
export const idSchema = z.string().min(1).max(64);

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
