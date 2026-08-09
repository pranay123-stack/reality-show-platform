import type { FastifyInstance } from 'fastify';

import { getConfig } from '../../core/config.js';
import { getHealth, statusToHttpCode } from './health.service.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness + dependency snapshot. Used by Docker healthchecks and humans. */
  app.get('/health', async (_request, reply) => {
    const health = await getHealth();
    return reply.status(statusToHttpCode(health.status)).send(health);
  });

  /** Readiness: strict — a degraded dependency means "do not send me traffic yet". */
  app.get('/ready', async (_request, reply) => {
    const health = await getHealth();
    const ready = health.dependencies.database === 'up' && health.dependencies.redis === 'up';
    return reply.status(ready ? 200 : 503).send({ ready, dependencies: health.dependencies });
  });

  /** Minimal service descriptor; helpful when several stacks run side by side. */
  app.get('/', async () => ({
    data: {
      name: 'reality-platform-api',
      version: getConfig().version,
      docs: '/api/v1',
    },
  }));
}
