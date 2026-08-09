import { API_PREFIX } from '@reality/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

import { getConfig } from '../config.js';
import { parseDuration } from './jwt.js';

export const ACCESS_COOKIE = 'rp_at';
export const REFRESH_COOKIE = 'rp_rt';
/**
 * Readable by JavaScript on purpose: the client echoes it back in a header, and
 * an attacker on another origin can neither read the cookie nor forge the
 * header. That is the double-submit CSRF pattern.
 */
export const CSRF_COOKIE = 'rp_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function baseOptions(): CookieSerializeOptions {
  const config = getConfig();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE ?? config.isProduction,
    path: '/',
    ...(config.COOKIE_DOMAIN && config.COOKIE_DOMAIN !== 'localhost'
      ? { domain: config.COOKIE_DOMAIN }
      : {}),
  };
}

export function setAuthCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string; rememberMe: boolean },
): void {
  const config = getConfig();
  const accessMaxAge = parseDuration(config.JWT_ACCESS_TTL);
  const refreshMaxAge = tokens.rememberMe
    ? parseDuration(config.JWT_REFRESH_TTL)
    : parseDuration('1d');

  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, { ...baseOptions(), maxAge: accessMaxAge });

  // Scoped to the auth routes so it is not attached to every ordinary request.
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(),
    path: `${API_PREFIX}/auth`,
    maxAge: refreshMaxAge,
  });

  reply.setCookie(CSRF_COOKIE, tokens.csrfToken, {
    ...baseOptions(),
    httpOnly: false,
    maxAge: refreshMaxAge,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const options = baseOptions();
  reply.clearCookie(ACCESS_COOKIE, options);
  reply.clearCookie(REFRESH_COOKIE, { ...options, path: `${API_PREFIX}/auth` });
  reply.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
}
