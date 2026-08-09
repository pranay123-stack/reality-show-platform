import {
  communityLeaderboardQuerySchema,
  createCommunitySchema,
  createCommunityTypeSchema,
  createConnectionSchema,
  exportLeaderboardSchema,
  freezeLeaderboardSchema,
  idParamSchema,
  inspectRankingQuerySchema,
  leaderboardQuerySchema,
  listCommunitiesQuerySchema,
  rebuildLeaderboardSchema,
  respondConnectionSchema,
  updatePrivacySchema,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import {
  authenticate,
  optionalAuthenticate,
  requireAuth,
  requirePermission,
} from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseParams, parseQuery } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import {
  createCommunity,
  createCommunityType,
  explainRanking,
  exportLeaderboard,
  freezeLeaderboard,
  getCommunityLeaderboard,
  getFriendsLeaderboard,
  getLeaderboard,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listCommunityTypes,
  listConnections,
  rebuildEverything,
  rebuildLeaderboard,
  requestConnection,
  respondToConnection,
  snapshotLeaderboard,
  toCsv,
  updatePrivacy,
} from './leaderboards.service.js';

/**
 * Every route here is a read of a derived ranking or a change to *who can see*
 * one. Notably absent: any endpoint that accepts a score, a rank or a points
 * total. A client cannot influence its position except by earning points, which
 * happens in the feature modules and lands in the ledger.
 */
export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  // --- public boards -------------------------------------------------------

  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, leaderboardQuerySchema);
    return { data: await getLeaderboard(request.auth?.userId ?? null, query) };
  });

  app.get('/friends', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const query = parseQuery(request, leaderboardQuerySchema);
    return { data: await getFriendsLeaderboard(auth.userId, query) };
  });

  app.get('/community', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, communityLeaderboardQuerySchema);
    const { communityId, ...options } = query;
    return {
      data: await getCommunityLeaderboard(request.auth?.userId ?? null, communityId, options),
    };
  });

  // --- communities ---------------------------------------------------------

  app.get('/communities', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, listCommunitiesQuerySchema);
    return { data: await listCommunities(request.auth?.userId ?? null, query) };
  });

  app.get('/communities/types', async () => ({ data: await listCommunityTypes() }));

  app.post('/communities/:id/join', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    await joinCommunity(id, auth.userId);
    return { data: { joined: true } };
  });

  app.post('/communities/:id/leave', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    await leaveCommunity(id, auth.userId);
    return { data: { joined: false } };
  });

  // --- connections & privacy ----------------------------------------------

  app.get('/connections', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: await listConnections(auth.userId) };
  });

  app.post(
    '/connections',
    {
      preHandler: [authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createConnectionSchema);
      const connection = await requestConnection(auth.userId, input.userId, input.kind);
      return reply.status(201).send({ data: connection });
    },
  );

  app.post('/connections/:id/respond', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    const { accept } = parseBody(request, respondConnectionSchema);
    return { data: await respondToConnection(id, auth.userId, accept) };
  });

  app.patch('/me/privacy', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const input = parseBody(request, updatePrivacySchema);
    return { data: await updatePrivacy(auth.userId, input) };
  });

  // --- administration ------------------------------------------------------

  /**
   * The audit view. Moderator-visible because "why is this account top of the
   * board" is a moderation question before it is an engineering one.
   */
  app.get(
    '/admin/inspect',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEADERBOARD_INSPECT)] },
    async (request) => {
      const query = parseQuery(request, inspectRankingQuerySchema);
      return { data: await explainRanking(query.userId, query.window) };
    },
  );

  app.post(
    '/admin/rebuild',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEADERBOARD_REBUILD)] },
    async (request) => {
      const input = parseBody(request, rebuildLeaderboardSchema);
      const result = await rebuildLeaderboard(input.window, input.periodKey);
      await writeAudit(request, 'leaderboard.rebuild', 'Leaderboard', result.periodKey, {
        after: result,
      });
      return { data: result };
    },
  );

  app.post(
    '/admin/rebuild-all',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEADERBOARD_REBUILD)] },
    async (request) => {
      const results = await rebuildEverything();
      await writeAudit(request, 'leaderboard.rebuild_all', 'Leaderboard', 'all', {
        after: { boards: results.length },
      });
      return { data: results };
    },
  );

  app.post(
    '/admin/snapshot',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEADERBOARD_REBUILD)] },
    async (request) => {
      const input = parseBody(request, rebuildLeaderboardSchema);
      const result = await snapshotLeaderboard(input.window, input.periodKey);
      await writeAudit(request, 'leaderboard.snapshot', 'Leaderboard', result.id, {
        after: result,
      });
      return { data: result };
    },
  );

  app.post(
    '/admin/freeze',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEADERBOARD_FREEZE)] },
    async (request) => {
      const auth = requireAuth(request);
      const input = parseBody(request, freezeLeaderboardSchema);
      const result = await freezeLeaderboard(
        input.window,
        input.frozen,
        auth.userId,
        input.periodKey,
      );
      await writeAudit(
        request,
        input.frozen ? 'leaderboard.freeze' : 'leaderboard.unfreeze',
        'Leaderboard',
        result.periodKey,
        { after: { ...result, reason: input.reason ?? null } },
      );
      return { data: result };
    },
  );

  app.get(
    '/admin/export',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEADERBOARD_EXPORT)] },
    async (request, reply) => {
      const query = parseQuery(request, exportLeaderboardSchema);
      const payload = await exportLeaderboard(query.window, query);

      await writeAudit(request, 'leaderboard.export', 'Leaderboard', payload.periodKey, {
        after: { format: query.format, rows: payload.rows.length },
      });

      if (query.format === 'csv') {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header(
            'Content-Disposition',
            `attachment; filename="leaderboard-${payload.window}-${payload.periodKey}.csv"`,
          )
          .send(toCsv(payload));
      }
      return { data: payload };
    },
  );

  app.post(
    '/admin/community-types',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COMMUNITY_MANAGE)] },
    async (request, reply) => {
      const input = parseBody(request, createCommunityTypeSchema);
      const type = await createCommunityType(input);
      await writeAudit(request, 'community.type_create', 'CommunityType', type.id, {
        after: input,
      });
      return reply.status(201).send({ data: type });
    },
  );

  app.post(
    '/admin/communities',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COMMUNITY_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createCommunitySchema);
      const community = await createCommunity(input, auth.userId);
      await writeAudit(request, 'community.create', 'Community', community.id, { after: input });
      return reply.status(201).send({ data: community });
    },
  );
}
