import { API_PREFIX, type ApiErrorBody } from '@reality/shared';

import { env } from './env';

/**
 * The single door to the API.
 *
 * Responsibilities kept here so no component has to think about them:
 *  - cookies travel on every request (`credentials: 'include'`)
 *  - the CSRF cookie is echoed back as a header on unsafe methods
 *  - a 401 caused by an expired access token triggers exactly one refresh and
 *    one retry, with concurrent callers sharing that single refresh
 *  - errors arrive as a typed `ApiError` carrying the server's machine-readable code
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody['error'] | undefined, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? 'UNKNOWN';
    this.details = body?.details;
  }

  /** Field-level messages from a Zod flatten(), when the server sent them. */
  get fieldErrors(): Record<string, string[]> {
    const details = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return details?.fieldErrors ?? {};
  }
}

const CSRF_COOKIE = 'rp_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for endpoints outside `/api/v1`, e.g. `/health`. */
  absolutePath?: boolean;
  /** Internal: prevents a refresh loop. */
  _retried?: boolean;
}

/** Shared in-flight refresh so ten parallel 401s cause one refresh, not ten. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${env.apiUrl}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see it.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, absolutePath, _retried, headers, ...rest } = options;
  const method = (rest.method ?? 'GET').toUpperCase();
  const url = `${env.apiUrl}${absolutePath ? '' : API_PREFIX}${path}`;

  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfCookie();
    if (csrf) requestHeaders.set(CSRF_HEADER, csrf);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      method,
      headers: requestHeaders,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new ApiError(0, undefined, `Could not reach the server. ${(error as Error).message}`);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const errorBody = (payload as ApiErrorBody | undefined)?.error;

    // An expired access token is recoverable exactly once, and only for a
    // request that was not itself the refresh.
    const isExpiredToken =
      response.status === 401 &&
      (errorBody?.code === 'TOKEN_INVALID' || errorBody?.code === 'TOKEN_EXPIRED');

    if (isExpiredToken && !_retried && !path.startsWith('/auth/refresh')) {
      if (await refreshSession()) {
        return apiFetch<T>(path, { ...options, _retried: true });
      }
    }

    throw new ApiError(response.status, errorBody, `Request failed (${response.status})`);
  }

  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
