import type { FastifyInstance, InjectOptions } from 'fastify';

import { buildApp } from '../../src/app.js';
import { CSRF_COOKIE, CSRF_HEADER } from '../../src/core/auth/cookies.js';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ minimal: true });
  await app.ready();
  return app;
}

/**
 * A tiny browser stand-in: keeps a cookie jar and replays the CSRF token as a
 * header, so tests exercise the same cookie + double-submit path a real client
 * uses rather than a bearer-token shortcut that skips CSRF entirely.
 */
export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private readonly app: FastifyInstance) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clear(): void {
    this.cookies.clear();
  }

  async request(options: InjectOptions) {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (this.cookies.size > 0) {
      headers.cookie = this.cookieHeader;
      const csrf = this.cookies.get(CSRF_COOKIE);
      if (csrf) headers[CSRF_HEADER] = csrf;
    }

    const response = await this.app.inject({ ...options, headers });
    this.absorbCookies(response.cookies as { name: string; value: string }[] | undefined);
    return response;
  }

  private absorbCookies(cookies: { name: string; value: string }[] | undefined): void {
    for (const cookie of cookies ?? []) {
      if (cookie.value === '') {
        this.cookies.delete(cookie.name);
      } else {
        this.cookies.set(cookie.name, cookie.value);
      }
    }
  }
}

export const VALID_PASSWORD = 'a-strong-enough-password';
