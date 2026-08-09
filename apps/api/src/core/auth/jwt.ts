import type { Role } from '@reality/shared';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { getConfig } from '../config.js';

/**
 * Access tokens are short-lived JWTs (stateless, cheap to verify on every
 * request). Refresh tokens are *not* JWTs — they are opaque random secrets
 * stored hashed in `UserSession`, so a refresh can be revoked server-side. That
 * asymmetry is deliberate: statelessness where it is cheap, revocability where
 * it matters.
 */

const ISSUER = 'reality-platform';
const AUDIENCE = 'reality-platform-web';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  sid: string;
  role: Role;
  typ: 'access';
}

function secretFor(kind: 'access' | 'refresh'): Uint8Array {
  const config = getConfig();
  return new TextEncoder().encode(
    kind === 'access' ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET,
  );
}

/** Converts `15m` / `2h` / `30d` / `900` into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 1;
  return amount * multiplier;
}

export async function signAccessToken(input: {
  userId: string;
  sessionId: string;
  role: Role;
}): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = parseDuration(getConfig().JWT_ACCESS_TTL);

  const token = await new SignJWT({ sid: input.sessionId, role: input.role, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secretFor('access'));

  return { token, expiresIn };
}

/** Returns null for any invalid, expired, or wrong-type token — never throws. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretFor('access'), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (payload.typ !== 'access' || typeof payload.sub !== 'string') return null;
    if (typeof payload.sid !== 'string' || typeof payload.role !== 'string') return null;

    return payload as AccessTokenClaims;
  } catch {
    return null;
  }
}
