import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '@reality/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export interface AppErrorOptions {
  code: ErrorCode | string;
  message: string;
  statusCode?: number;
  details?: unknown;
  /** Attach the underlying error for the log line without exposing it to the client. */
  cause?: unknown;
  /** When true the message is safe to show verbatim to end users. */
  expose?: boolean;
}

/**
 * The only error type the application layer should throw.
 *
 * `message` is user-facing when `expose` is true (the default for 4xx). Internal
 * detail belongs in `cause`, which is logged but never serialised to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 400;
    this.details = options.details;
    this.expose = options.expose ?? this.statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError({ code: ERROR_CODES.BAD_REQUEST, message, statusCode: 400, details });

export const unauthenticated = (message = 'Authentication required') =>
  new AppError({ code: ERROR_CODES.UNAUTHENTICATED, message, statusCode: 401 });

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError({ code: ERROR_CODES.FORBIDDEN, message, statusCode: 403 });

export const notFound = (message = 'Resource not found') =>
  new AppError({ code: ERROR_CODES.NOT_FOUND, message, statusCode: 404 });

export const conflict = (code: ErrorCode | string, message: string, details?: unknown) =>
  new AppError({ code, message, statusCode: 409, details });

export const unprocessable = (code: ErrorCode | string, message: string, details?: unknown) =>
  new AppError({ code, message, statusCode: 422, details });

export const tooManyRequests = (message = 'Too many requests, please slow down') =>
  new AppError({ code: ERROR_CODES.RATE_LIMITED, message, statusCode: 429 });

export const internal = (message: string, cause?: unknown) =>
  new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    message,
    statusCode: 500,
    cause,
    expose: false,
  });

/** Prisma unique-constraint violations surface as P2002. */
function isPrismaKnownError(error: unknown): error is { code: string; meta?: { target?: string[] } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((error as { code: string }).code)
  );
}

function toErrorBody(
  error: unknown,
  requestId: string,
): { statusCode: number; body: ApiErrorBody; logLevel: 'warn' | 'error' } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      logLevel: error.statusCode >= 500 ? 'error' : 'warn',
      body: {
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Something went wrong on our side',
          ...(error.details !== undefined ? { details: error.details } : {}),
          requestId,
        },
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      logLevel: 'warn',
      body: {
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: error.flatten(),
          requestId,
        },
      },
    };
  }

  if (isPrismaKnownError(error)) {
    if (error.code === 'P2002') {
      return {
        statusCode: 409,
        logLevel: 'warn',
        body: {
          error: {
            code: ERROR_CODES.CONFLICT,
            message: 'That record already exists',
            details: { fields: error.meta?.target ?? [] },
            requestId,
          },
        },
      };
    }
    if (error.code === 'P2025') {
      return {
        statusCode: 404,
        logLevel: 'warn',
        body: {
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found', requestId },
        },
      };
    }
  }

  const fastifyError = error as FastifyError;
  if (fastifyError?.statusCode && fastifyError.statusCode < 500) {
    return {
      statusCode: fastifyError.statusCode,
      logLevel: 'warn',
      body: {
        error: {
          code: fastifyError.code ?? ERROR_CODES.BAD_REQUEST,
          message: fastifyError.message,
          requestId,
        },
      },
    };
  }

  return {
    statusCode: 500,
    logLevel: 'error',
    body: {
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Something went wrong on our side',
        requestId,
      },
    },
  };
}

/**
 * Single error funnel. Nothing beyond this point is allowed to leak a stack
 * trace, SQL fragment, or internal message to a client.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, body, logLevel } = toErrorBody(error, request.id);

    request.log[logLevel](
      {
        err: error,
        code: body.error.code,
        statusCode,
        method: request.method,
        url: request.url,
      },
      'request failed',
    );

    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: `Route ${request.method} ${request.url} not found`,
        requestId: request.id,
      },
    } satisfies ApiErrorBody);
  });
}
