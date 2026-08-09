import type { HealthResponse } from '@reality/shared';

import { getConfig } from '../../core/config.js';
import { checkDatabase } from '../../core/prisma.js';
import { checkRedis } from '../../core/redis.js';

const startedAt = Date.now();

export interface HealthDependencies {
  checkDatabase: () => Promise<boolean>;
  checkRedis: () => Promise<boolean>;
}

const defaultDependencies: HealthDependencies = {
  checkDatabase: () => checkDatabase(),
  checkRedis: () => checkRedis(),
};

/**
 * Liveness + dependency probe.
 *
 * `ok`        — everything reachable
 * `degraded`  — the process is alive but a dependency is down (Redis outage
 *               degrades caching but the API still serves reads)
 * `error`     — the database is unreachable, so almost nothing works
 */
export async function getHealth(
  dependencies: HealthDependencies = defaultDependencies,
): Promise<HealthResponse> {
  const [database, redisUp] = await Promise.all([
    dependencies.checkDatabase(),
    dependencies.checkRedis(),
  ]);

  const status: HealthResponse['status'] = !database ? 'error' : redisUp ? 'ok' : 'degraded';

  return {
    status,
    uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    version: getConfig().version,
    timestamp: new Date().toISOString(),
    dependencies: {
      database: database ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
    },
  };
}

export function statusToHttpCode(status: HealthResponse['status']): number {
  return status === 'error' ? 503 : 200;
}
