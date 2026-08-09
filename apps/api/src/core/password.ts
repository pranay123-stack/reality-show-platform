import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

// `promisify` resolves to the 3-argument overload, so the options-taking form is
// re-typed here rather than being called with a cast at each site.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with Node's built-in scrypt.
 *
 * scrypt is memory-hard and is an OWASP-accepted alternative to Argon2id. Using
 * the platform primitive keeps the project free of a native build dependency,
 * which matters for reproducible Docker images.
 *
 * Encoded form: `scrypt$N$r$p$keylen$saltB64$hashB64`
 * The parameters travel with the hash, so they can be raised later without
 * invalidating existing passwords (see `needsRehash`).
 */
export const SCRYPT_PARAMS = {
  N: 2 ** 15, // CPU/memory cost — ~32 MiB per hash
  r: 8,
  p: 1,
  keylen: 64,
  saltBytes: 16,
} as const;

const PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  const salt = randomBytes(SCRYPT_PARAMS.saltBytes);
  const derived = (await scrypt(password.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    // Node's default maxmem (32 MiB) is exactly at the limit for N=2^15; raise it.
    maxmem: 256 * 1024 * 1024,
  }));

  return [
    PREFIX,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    SCRYPT_PARAMS.keylen,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification. Returns false for any malformed stored value
 * rather than throwing, so a corrupted row cannot be distinguished from a wrong
 * password by timing or by error text.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 7 || parts[0] !== PREFIX) return false;

    const [, nRaw, rRaw, pRaw, keylenRaw, saltB64, hashB64] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    const N = Number.parseInt(nRaw, 10);
    const r = Number.parseInt(rRaw, 10);
    const p = Number.parseInt(pRaw, 10);
    const keylen = Number.parseInt(keylenRaw, 10);
    if (![N, r, p, keylen].every((value) => Number.isInteger(value) && value > 0)) return false;
    // Refuse absurd parameters that could be used to force a CPU/memory blow-up.
    if (N > 2 ** 20 || r > 32 || p > 16 || keylen > 256) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (expected.length !== keylen) return false;

    const derived = (await scrypt(password.normalize('NFKC'), salt, keylen, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    }));

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 7 || parts[0] !== PREFIX) return true;
  const [, n, r, p, keylen] = parts;
  return (
    Number(n) < SCRYPT_PARAMS.N ||
    Number(r) < SCRYPT_PARAMS.r ||
    Number(p) < SCRYPT_PARAMS.p ||
    Number(keylen) < SCRYPT_PARAMS.keylen
  );
}
