import { buildApp } from './app.js';
import { attachRealtime } from './realtime/server.js';
import { getConfig } from './core/config.js';
import { checkDatabase, disconnectPrisma } from './core/prisma.js';
import { checkRedis, disconnectRedis } from './core/redis.js';
import { settleDomainEvents } from './core/domain-events.js';
import { aggregateRange } from './modules/analytics/aggregation.js';
import { settleAnalytics } from './modules/analytics/analytics.service.js';
import {
  cancelScheduledSync,
  syncLeaderboards,
} from './modules/leaderboards/projector.js';

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

  // The leaderboard projection is nudged after every points award, but a
  // heartbeat covers the quiet case: a straggler row committed out of order
  // with no further activity behind it to trigger a drain. Deliberately in the
  // server entrypoint rather than `buildApp`, so tests get no background timer
  // racing their assertions.
  const projectionTimer = setInterval(() => {
    void syncLeaderboards().catch((error) =>
      app.log.warn({ err: error }, 'leaderboard projection pass failed'),
    );
  }, config.HEAT_RECOMPUTE_INTERVAL_MS);
  projectionTimer.unref();

  /**
   * The analytics aggregation pass.
   *
   * Deliberately hourly and deliberately only the last two days: yesterday can
   * still receive late events, and everything older is already settled. A full
   * recompute is an operator action, not something a server does on a timer.
   *
   * In the server entrypoint rather than `buildApp` so tests get no background
   * pass racing their assertions.
   */
  const runAggregation = () =>
    void aggregateRange(2).catch((error) =>
      app.log.warn({ err: error }, 'analytics aggregation pass failed'),
    );

  const analyticsTimer = setInterval(runAggregation, config.ANALYTICS_INTERVAL_MS);
  analyticsTimer.unref();
  // One pass at boot so a freshly started stack has numbers to show.
  runAggregation();

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
  app.log.info('realtime namespace /live attached');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      clearInterval(projectionTimer);
      clearInterval(analyticsTimer);
      cancelScheduledSync();
      // Let queued notification fan-outs finish rather than cutting them off
      // half-written; they are short and the alternative is a lost telling.
      await settleDomainEvents();
      await settleAnalytics();
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
