import { buildApp } from './app.js';
import { attachRealtime } from './realtime/server.js';
import { getConfig } from './core/config.js';
import { checkDatabase, disconnectPrisma } from './core/prisma.js';
import { checkRedis, disconnectRedis } from './core/redis.js';

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp();

  // Fail fast and loudly: a silent boot with a dead database is worse than a crash.
  const [databaseUp, redisUp] = await Promise.all([checkDatabase(), checkRedis()]);

  if (!databaseUp) {
    app.log.error(
      'PostgreSQL is unreachable. Is `pnpm dev:infra` running and DATABASE_URL correct?',
    );
    process.exit(1);
  }
  if (!redisUp) {
    app.log.error('Redis is unreachable. Is `pnpm dev:infra` running and REDIS_URL correct?');
    process.exit(1);
  }

  app.log.info({ database: 'up', redis: 'up' }, 'dependencies verified');

  // Socket.IO binds to the same HTTP server, so realtime and REST share a port
  // and a single TLS terminator in production.
  await attachRealtime(app);

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
  app.log.info('realtime namespace /live attached');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await Promise.all([disconnectPrisma(), disconnectRedis()]);
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'graceful shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
