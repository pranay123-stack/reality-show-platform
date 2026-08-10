import {
  CONTESTANT_STATUSES,
  HEAT_WINDOWS,
  createContestantSchema,
  idParamSchema,
  setContestantStatusSchema,
  updateContestantSchema,
  type HeatWindow,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requirePermission } from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseParams, parseQuery } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import { getCurrentShowId } from '../show/show.service.js';
import {
  createContestant,
  getContestant,
  getHeatHistory,
  listContestants,
  listContestantsForAdmin,
  recordProfileView,
  setContestantStatus,
  updateContestant,
} from './contestants.service.js';
import { inspectHeat, recomputeShowHeat } from './heat.service.js';

const listQuerySchema = z.object({
  // Constrained to the enum: an arbitrary string reached Prisma as an enum
  // filter and produced a 500 rather than a 400.
  status: z.enum(CONTESTANT_STATUSES).optional(),
  sort: z.enum(['heat', 'name']).optional(),
});

const historyQuerySchema = z.object({
  window: z.enum(HEAT_WINDOWS).default('24h'),
});

export async function contestantRoutes(app: FastifyInstance): Promise<void> {
  // --- operator management -------------------------------------------------
  //
  // Registered before `/:id` so `/admin` is never read as a contestant slug.

  app.get(
    '/admin/list',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONTESTANT_MANAGE)] },
    async () => ({ data: await listContestantsForAdmin() }),
  );

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONTESTANT_MANAGE)] },
    async (request, reply) => {
      const input = parseBody(request, createContestantSchema);
      const contestant = await createContestant(input);
      await writeAudit(request, 'contestant.create', 'Contestant', contestant.id, { after: input });
      return reply.status(201).send({ data: contestant });
    },
  );

  app.patch(
    '/admin/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONTESTANT_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, updateContestantSchema);
      const contestant = await updateContestant(id, input);
      await writeAudit(request, 'contestant.update', 'Contestant', id, { after: input });
      return { data: contestant };
    },
  );

  app.post(
    '/admin/:id/status',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONTESTANT_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const { status, reason } = parseBody(request, setContestantStatusSchema);
      const contestant = await setContestantStatus(id, status);
      await writeAudit(request, `contestant.status.${status.toLowerCase()}`, 'Contestant', id, {
        after: { status, reason: reason ?? null },
      });
      return { data: contestant };
    },
  );

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
