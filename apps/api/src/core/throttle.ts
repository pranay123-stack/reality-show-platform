import { redis } from './redis.js';

/**
 * Failure counters for brute-force protection.
 *
 * Separate from the HTTP rate limiter: that one caps *request volume*, this one
 * caps *failed attempts* — 200 successful logins are fine, 20 failed ones are
 * not. Counters live in Redis so they hold across API instances and restarts.
 */

export interface ThrottleState {
  attempts: number;
  lockedUntil: Date | null;
}

export interface ThrottlePolicy {
  /** Failures allowed before the first lock-out. */
  threshold: number;
  /** How long failures are remembered. */
  windowSeconds: number;
  /** Base lock duration; doubles for each additional failure past the threshold. */
  lockSeconds: number;
  /** Upper bound so an attacker cannot lock a victim out indefinitely. */
  maxLockSeconds: number;
}

export const LOGIN_POLICY: ThrottlePolicy = {
  threshold: 5,
  windowSeconds: 15 * 60,
  lockSeconds: 60,
  maxLockSeconds: 15 * 60,
};

/**
 * IP-scoped limit. Deliberately much more forgiving than the per-account one:
 * a university, office or mobile carrier NAT puts thousands of legitimate
 * people behind one address, and locking them all out because one of them
 * mistyped a password five times would be a self-inflicted outage.
 */
export const LOGIN_IP_POLICY: ThrottlePolicy = {
  threshold: 30,
  windowSeconds: 15 * 60,
  lockSeconds: 60,
  maxLockSeconds: 10 * 60,
};

export const SENSITIVE_ACTION_POLICY: ThrottlePolicy = {
  threshold: 3,
  windowSeconds: 60 * 60,
  lockSeconds: 5 * 60,
  maxLockSeconds: 60 * 60,
};

const attemptsKey = (scope: string) => `throttle:attempts:${scope}`;
const lockKey = (scope: string) => `throttle:lock:${scope}`;

export async function getThrottleState(scope: string): Promise<ThrottleState> {
  try {
    const [attempts, lockTtl] = await Promise.all([
      redis.get(attemptsKey(scope)),
      redis.pttl(lockKey(scope)),
    ]);

    return {
      attempts: attempts ? Number(attempts) : 0,
      lockedUntil: lockTtl > 0 ? new Date(Date.now() + lockTtl) : null,
    };
  } catch {
    // Redis down: fail open rather than locking every user out of the product.
    return { attempts: 0, lockedUntil: null };
  }
}

export async function recordFailure(
  scope: string,
  policy: ThrottlePolicy = LOGIN_POLICY,
): Promise<ThrottleState> {
  try {
    const attempts = await redis.incr(attemptsKey(scope));
    if (attempts === 1) {
      await redis.expire(attemptsKey(scope), policy.windowSeconds);
    }

    if (attempts >= policy.threshold) {
      const overage = attempts - policy.threshold;
      const seconds = Math.min(policy.lockSeconds * 2 ** overage, policy.maxLockSeconds);
      await redis.set(lockKey(scope), '1', 'EX', seconds);
      return { attempts, lockedUntil: new Date(Date.now() + seconds * 1000) };
    }

    return { attempts, lockedUntil: null };
  } catch {
    return { attempts: 0, lockedUntil: null };
  }
}

export async function clearFailures(scope: string): Promise<void> {
  try {
    await redis.del(attemptsKey(scope), lockKey(scope));
  } catch {
    /* best effort */
  }
}

export function secondsUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}
