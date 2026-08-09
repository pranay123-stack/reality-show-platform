import { HEAT_WINDOWS, idParamSchema, type HeatWindow } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requirePermission } from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseParams, parseQuery } from '../../core/validation.js';
import { getCurrentShowId } from '../show/show.service.js';
import {
  getContestant,
  getHeatHistory,
  listContestants,
  recordProfileView,
} from './contestants.service.js';
import { inspectHeat, recomputeShowHeat } from './heat.service.js';

const listQuerySchema = z.object({
  status: z.string().optional(),
  sort: z.enum(['heat', 'name']).optional(),
});

const historyQuerySchema = z.object({
  window: z.enum(HEAT_WINDOWS).default('24h'),
});

export async function contestantRoutes(app: FastifyInstance): Promise<void> {
  /** Public list, ordered by heat. */
  app.get('/', async (request) => {
    const query = parseQuery(request, listQuerySchema);
    return { data: await listContestants(query) };
  });

  /** Public detail page payload. Accepts an id or a slug. */
  app.get('/:id', async (request) => {
    const { id } = parseParams(request, idParamSchema);
    const contestant = await getContestant(id);

    // A view is a heat signal, but it must never delay or fail the response.
    void recordProfileView(contestant.id).catch(() => undefined);

    return { data: contestant };
  });

  app.get('/:id/heat', async (request) => {
    const { id } = parseParams(request, idParamSchema);
    const { window } = parseQuery(request, historyQuerySchema);
    return { data: await getHeatHistory(id, window as HeatWindow) };
  });

  /**
   * Operator view of the heat calculation: raw signals, normalised values,
   * weights and each component's contribution.
   */
  app.get(
    '/:id/heat/inspect',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HEAT_INSPECT)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      return { data: await inspectHeat(id) };
    },
  );

  /** Manual recompute. The scheduler calls the same service on an interval. */
  app.post(
    '/heat/recompute',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HEAT_INSPECT)] },
    async () => {
      const showId = await getCurrentShowId();
      return { data: await recomputeShowHeat(showId) };
    },
  );
}
