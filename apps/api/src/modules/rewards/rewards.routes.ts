import {
  addInventorySchema,
  authoriseRewardSchema,
  createRewardSchema,
  decideRedemptionSchema,
  idParamSchema,
  listRedemptionsQuerySchema,
  listRewardsQuerySchema,
  redeemRewardSchema,
  rejectRedemptionSchema,
  setRewardStatusSchema,
  updateRewardSchema,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';

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
  addInventory,
  approveRedemption,
  authoriseReward,
  cancelOwnRedemption,
  cancelRedemptionAsAdmin,
  createReward,
  fulfilRedemption,
  getMyRedemption,
  getReward,
  getUserLevel,
  listMyRedemptions,
  listRedemptionsForAdmin,
  listRewards,
  listRewardsForAdmin,
  redeemReward,
  rejectRedemption,
  retireReward,
  setRewardStatus,
  updateReward,
} from './rewards.service.js';

export async function rewardRoutes(app: FastifyInstance): Promise<void> {
  // --- catalogue -----------------------------------------------------------

  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, listRewardsQuerySchema);
    return { data: await listRewards(request.auth?.userId ?? null, query) };
  });

  app.get('/me/level', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: await getUserLevel(auth.userId) };
  });

  /** Registered before `/:id` so the literal path is never read as an id. */
  app.get('/me/redemptions', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { status } = parseQuery(request, listRedemptionsQuerySchema);
    return { data: await listMyRedemptions(auth.userId, status) };
  });

  app.get('/me/redemptions/:id', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    return { data: await getMyRedemption(id, auth.userId) };
  });

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getReward(id, request.auth?.userId ?? null) };
  });

  // --- redemption ----------------------------------------------------------

  app.post(
    '/:id/redeem',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      parseBody(request, redeemRewardSchema.optional().default({}));

      const result = await redeemReward(id, auth.userId);
      await writeAudit(request, 'reward.redeem', 'RewardRedemption', result.redemption.id, {
        after: { rewardId: id, pointsSpent: result.pointsSpent },
      });
      return reply.status(201).send({ data: result });
    },
  );

  app.post('/me/redemptions/:id/cancel', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    const { note } = parseBody(request, decideRedemptionSchema);
    const redemption = await cancelOwnRedemption(id, auth.userId, note);
    await writeAudit(request, 'reward.cancel_own', 'RewardRedemption', id);
    return { data: redemption };
  });

  // --- administration ------------------------------------------------------

  /** Moderators can look at the catalogue and the queue, and nothing else. */
  app.get(
    '/admin/catalogue',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_VIEW)] },
    async () => ({ data: await listRewardsForAdmin() }),
  );

  app.get(
    '/admin/redemptions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_VIEW)] },
    async (request) => {
      const query = parseQuery(request, listRedemptionsQuerySchema);
      return { data: await listRedemptionsForAdmin(query) };
    },
  );

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request, reply) => {
      // Who created it is recorded by the audit entry below, not on the row.
      const input = parseBody(request, createRewardSchema);
      const reward = await createReward(input);
      await writeAudit(request, 'reward.create', 'RewardCatalog', reward.id, { after: input });
      return reply.status(201).send({ data: reward });
    },
  );

  app.patch(
    '/admin/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, updateRewardSchema);
      const reward = await updateReward(id, input);
      await writeAudit(request, 'reward.update', 'RewardCatalog', id, { after: input });
      return { data: reward };
    },
  );

  app.post(
    '/admin/:id/inventory',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, addInventorySchema);
      const inventory = await addInventory(id, input.units);
      await writeAudit(request, 'reward.inventory_add', 'RewardCatalog', id, { after: input });
      return { data: inventory };
    },
  );

  app.post(
    '/admin/:id/status',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const { status } = parseBody(request, setRewardStatusSchema);
      const reward = await setRewardStatus(id, status);
      await writeAudit(request, `reward.status.${status.toLowerCase()}`, 'RewardCatalog', id);
      return { data: reward };
    },
  );

  /**
   * Authorising a physical or experience reward — its own permission, the same
   * control weekend participation applies to an in-person opportunity.
   */
  app.post(
    '/admin/:id/authorise',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_PHYSICAL_AUTHORISE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, authoriseRewardSchema);
      const reward = await authoriseReward(id, auth.userId, input);
      await writeAudit(request, 'reward.authorise', 'RewardCatalog', id, { after: input });
      return { data: reward };
    },
  );

  /** Retiring pulls a reward permanently — admin only. */
  app.post(
    '/admin/:id/retire',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_RETIRE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const reward = await retireReward(id);
      await writeAudit(request, 'reward.retire', 'RewardCatalog', id);
      return { data: reward };
    },
  );

  // --- fulfilment workflow -------------------------------------------------

  app.post(
    '/admin/redemptions/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { note } = parseBody(request, decideRedemptionSchema);
      const redemption = await approveRedemption(id, auth.userId, note);
      await writeAudit(request, 'reward.approve', 'RewardRedemption', id, { after: { note } });
      return { data: redemption };
    },
  );

  app.post(
    '/admin/redemptions/:id/fulfil',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { note } = parseBody(request, decideRedemptionSchema);
      const redemption = await fulfilRedemption(id, auth.userId, note);
      await writeAudit(request, 'reward.fulfil', 'RewardRedemption', id, { after: { note } });
      return { data: redemption };
    },
  );

  app.post(
    '/admin/redemptions/:id/reject',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_MANAGE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { reason } = parseBody(request, rejectRedemptionSchema);
      const redemption = await rejectRedemption(id, auth.userId, reason);
      await writeAudit(request, 'reward.reject', 'RewardRedemption', id, { after: { reason } });
      return { data: redemption };
    },
  );

  /** Cancelling someone else's redemption takes something back — admin only. */
  app.post(
    '/admin/redemptions/:id/cancel',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REWARD_FORCE_CANCEL)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { note } = parseBody(request, decideRedemptionSchema);
      const redemption = await cancelRedemptionAsAdmin(id, auth.userId, note);
      await writeAudit(request, 'reward.force_cancel', 'RewardRedemption', id, { after: { note } });
      return { data: redemption };
    },
  );
}
