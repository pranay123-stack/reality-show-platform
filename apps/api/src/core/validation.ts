import { ERROR_CODES } from '@reality/shared';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { AppError } from './errors.js';

/**
 * Explicit request parsing.
 *
 * Handlers call these instead of trusting `request.body`, so nothing unvalidated
 * can reach a service. The parsed value is the *only* thing passed downstream.
 */
export function parseWith<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  source: 'body' | 'query' | 'params' | 'headers',
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `Invalid request ${source}`,
      statusCode: 400,
      details: result.error.flatten(),
    });
  }
  return result.data;
}

export const parseBody = <T extends z.ZodTypeAny>(request: FastifyRequest, schema: T): z.infer<T> =>
  parseWith(schema, request.body, 'body');

export const parseQuery = <T extends z.ZodTypeAny>(request: FastifyRequest, schema: T): z.infer<T> =>
  parseWith(schema, request.query, 'query');

export const parseParams = <T extends z.ZodTypeAny>(
  request: FastifyRequest,
  schema: T,
): z.infer<T> => parseWith(schema, request.params, 'params');
