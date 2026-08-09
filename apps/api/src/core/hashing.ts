import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { getConfig } from './config.js';

/**
 * Non-password hashing helpers.
 *
 * Bearer-style secrets (refresh tokens, verification links) are stored as SHA-256
 * digests: they are already high-entropy, so a slow KDF buys nothing, while the
 * digest still means a database leak yields no usable token.
 *
 * Correlation identifiers (IP, device) are HMAC-ed with a server secret so they
 * cannot be reversed by anyone holding only the database.
 */

/** URL-safe random secret. 32 bytes → 43 characters of base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string, purpose: string): string {
  return createHmac('sha256', `${getConfig().COOKIE_SECRET}:${purpose}`).update(value).digest('hex');
}

/** Pseudonymous IP identifier. Never store or log the raw address. */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return hmac(ip, 'ip');
}

/**
 * Coarse device correlation from request-level signals only.
 *
 * No canvas, WebGL, audio or font fingerprinting, and no advertising
 * identifiers — this is a weak, privacy-respecting hint used to raise a
 * duplicate-account suspicion for human review, never to identify a person.
 */
export function deviceHash(input: {
  userAgent?: string;
  acceptLanguage?: string;
  ip?: string;
}): string {
  const material = [
    input.userAgent ?? 'unknown-ua',
    input.acceptLanguage ?? 'unknown-lang',
    // Only the network prefix, so a whole household or campus collapses to one
    // bucket instead of pinpointing a machine.
    ipPrefix(input.ip),
  ].join('|');

  return hmac(material, 'device');
}

function ipPrefix(ip: string | undefined): string {
  if (!ip) return 'unknown-ip';
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 3).join(':'); // IPv6 /48
  }
  return ip.split('.').slice(0, 3).join('.'); // IPv4 /24
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
