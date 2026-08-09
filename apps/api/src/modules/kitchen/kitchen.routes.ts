import {
  createKitchenBudgetSchema,
  createKitchenDecisionSchema,
  idParamSchema,
  implementKitchenResultSchema,
  kitchenVoteSchema,
  listKitchenQuerySchema,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  authenticate,
  optionalAuthenticate,
  requireAuth,
  requirePermission,
  requireVerifiedEmail,
} from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseParams, parseQuery } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import {
  castKitchenVote,
  closeDecision,
  createBudget,
  createDecision,
  getDecision,
  listBudgets,
  listDecisions,
  listDecisionsForAdmin,
  openDecision,
  publishAudienceResult,
  recordImplementedResult,
  withdrawKitchenVote,
} from './kitchen.service.js';

const withdrawSchema = z.object({ optionId: z.string().min(1) });

export async function kitchenRoutes(app: FastifyInstance): Promise<void> {
  // --- reading -------------------------------------------------------------

  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, listKitchenQuerySchema);
    return { data: await listDecisions(request.auth?.userId ?? null, query) };
  });

  app.get('/budgets', async () => ({ data: await listBudgets() }));

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getDecision(id, request.auth?.userId ?? null) };
  });

  // --- voting --------------------------------------------------------------

  app.post(
    '/:id/votes',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { optionIds } = parseBody(request, kitchenVoteSchema);
      return { data: await castKitchenVote(id, auth.userId, optionIds) };
    },
  );

  app.delete('/:id/votes', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    const { optionId } = parseBody(request, withdrawSchema);
    return { data: await withdrawKitchenVote(id, auth.userId, optionId) };
  });

  // --- operator ------------------------------------------------------------

  app.get(
    '/admin/list',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.KITCHEN_MANAGE)] },
    async () => ({ data: await listDecisionsForAdmin() }),
  );

  app.post(
    '/admin/budgets',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.KITCHEN_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createKitchenBudgetSchema);
      const budget = await createBudget(input, auth.userId);
      await writeAudit(request, 'kitchen.budget.create', 'KitchenBudget', budget.id, {
        after: input,
      });
      return reply.status(201).send({ data: budget });
    },
  );

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.KITCHEN_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createKitchenDecisionSchema);
      const decision = await createDecision(input, auth.userId);
      await writeAudit(request, 'kitchen.create', 'KitchenDecision', decision.id, { after: input });
      return reply.status(201).send({ data: decision });
    },
  );

  app.post(
    '/admin/:id/open',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.KITCHEN_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const decision = await openDecision(id);
      await writeAudit(request, 'kitchen.open', 'KitchenDecision', id);
      return { data: decision };
    },
  );

  app.post(
    '/admin/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.KITCHEN_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const result = await closeDecision(id);
      await writeAudit(request, 'kitchen.close', 'KitchenDecision', id);
      return { data: result };
    },
  );

  /** Publishes what the audience chose. Advisory — spends nothing. */
  app.post(
    '/admin/:id/publish-audience-result',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ROUND_PUBLISH)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const decision = await publishAudienceResult(id, auth.userId);
      await writeAudit(request, 'kitchen.publish_audience', 'KitchenDecision', id, {
        after: { audienceResult: decision.audienceResult },
      });
      return { data: decision };
    },
  );

  /**
   * Records what production actually gave the house. Separate endpoint,
   * separate permission, separate column — and the only thing that spends
   * budget.
   */
  app.post(
    '/admin/:id/implement',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OFFICIAL_OUTCOME_PUBLISH)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, implementKitchenResultSchema);
      const result = await recordImplementedResult(id, auth.userId, input);
      await writeAudit(request, 'kitchen.implement', 'KitchenDecision', id, {
        after: { optionIds: input.optionIds, cost: result.cost, note: input.note ?? null },
      });
      return { data: result };
    },
  );
}
