import Redis, { type RedisOptions } from 'ioredis';

import { getConfig } from './config.js';

const globalForRedis = globalThis as unknown as { __realityRedis?: Redis };

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy(times) {
    // Back off quickly at first, then settle at 3s. Never give up: a Redis blip
    // must degrade the cache, not kill the process.
    return Math.min(times * 200, 3000);
  },
};

export function createRedisClient(options: RedisOptions = {}): Redis {
  const client = new Redis(getConfig().REDIS_URL, { ...baseOptions, ...options });
  // Without a listener ioredis emits unhandled 'error' events and crashes the process.
  client.on('error', () => {
    /* surfaced by health checks and by the caller's try/catch */
  });
  return client;
}

export const redis: Redis = globalForRedis.__realityRedis ?? createRedisClient();

if (!getConfig().isProduction) {
  globalForRedis.__realityRedis = redis;
}

export async function checkRedis(client: Redis = redis): Promise<boolean> {
  try {
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function disconnectRedis(client: Redis = redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
