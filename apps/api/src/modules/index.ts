import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import { authRoutes } from './auth/auth.routes.js';
import { challengeRoutes } from './challenges/challenges.routes.js';
import { contestantRoutes } from './contestants/contestants.routes.js';
import { dashboardRoutes } from './dashboard/dashboard.routes.js';
import { healthRoutes } from './health/health.routes.js';
import { perspectiveRoutes } from './perspectives/perspectives.routes.js';
import { pollRoutes } from './polls/polls.routes.js';
import { evictionRoutes, nominationRoutes } from './rounds/rounds.routes.js';
import { predictionRoutes } from './predictions/predictions.routes.js';
import { showRoutes } from './show/show.routes.js';
import { userRoutes } from './users/users.routes.js';

const MODULES = ['health', 'auth', 'users', 'show', 'dashboard', 'contestants', 'predictions', 'challenges', 'perspectives', 'polls', 'nominations', 'evictions'];

/**
 * Single registration point for every feature module.
 *
 * System routes live at the root; every business route is namespaced under
 * `/api/v1` so the surface can be versioned without touching handlers.
 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);

  await app.register(
    async (api) => {
      api.get('/', async () => ({ data: { version: 'v1', modules: MODULES } }));

      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(showRoutes, { prefix: '/show' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(contestantRoutes, { prefix: '/contestants' });
      await api.register(predictionRoutes, { prefix: '/predictions' });
      await api.register(challengeRoutes, { prefix: '/challenges' });
      await api.register(perspectiveRoutes, { prefix: '/perspectives' });
      await api.register(pollRoutes, { prefix: '/polls' });
      await api.register(nominationRoutes, { prefix: '/nominations' });
      await api.register(evictionRoutes, { prefix: '/evictions' });
    },
    { prefix: API_PREFIX },
  );
}
