import {
  challengeFeedQuerySchema,
  createChallengeSchema,
  executeChallengeSchema,
  idParamSchema,
  moderateChallengeSchema,
  moderationQueueQuerySchema,
  reportChallengeSchema,
  updateChallengeSchema,
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
  createChallenge,
  getChallenge,
  getChallengeFeed,
  getModerationQueue,
  markCompleted,
  markExecuted,
  moderateChallenge,
  openForVoting,
  promoteTopChallenges,
  reportChallenge,
  selectChallenge,
  sendToProducerReview,
  submitChallenge,
  updateOwnChallenge,
  voteForChallenge,
  withdrawVote,
} from './challenges.service.js';

const cycleParamSchema = z.object({ cycleId: z.string().min(1) });

export async function challengeRoutes(app: FastifyInstance): Promise<void> {
  // --- reading -------------------------------------------------------------

  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, challengeFeedQuerySchema);
    return { data: await getChallengeFeed(request.auth?.userId ?? null, query) };
  });

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getChallenge(id, request.auth?.userId ?? null) };
  });

  // --- authoring -----------------------------------------------------------

  app.post(
    '/',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      // Authoring is far rarer than voting, so the limit is much tighter.
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createChallengeSchema);
      const challenge = await createChallenge(auth.userId, input);
      return reply.status(201).send({ data: challenge });
    },
  );

  app.patch('/:id', { preHandler: [authenticate, requireVerifiedEmail] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    const input = parseBody(request, updateChallengeSchema);
    return { data: await updateOwnChallenge(id, auth.userId, input) };
  });

  app.post('/:id/submit', { preHandler: [authenticate, requireVerifiedEmail] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    return { data: await submitChallenge(id, auth.userId) };
  });

  // --- voting --------------------------------------------------------------

  app.post(
    '/:id/vote',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      return { data: await voteForChallenge(id, auth.userId) };
    },
  );

  app.delete('/:id/vote', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parseParams(request, idParamSchema);
    return { data: await withdrawVote(id, auth.userId) };
  });

  // --- abuse reporting -----------------------------------------------------

  app.post(
    '/:id/report',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, reportChallengeSchema);
      return { data: await reportChallenge(id, auth.userId, input) };
    },
  );

  // --- moderation ----------------------------------------------------------

  app.get(
    '/admin/queue',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_MODERATE)] },
    async (request) => {
      const query = parseQuery(request, moderationQueueQuerySchema);
      return { data: await getModerationQueue(query) };
    },
  );

  app.post(
    '/admin/:id/moderate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_MODERATE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, moderateChallengeSchema);
      const challenge = await moderateChallenge(id, auth.userId, input.decision, input.reason);
      await writeAudit(request, `challenge.${input.decision.toLowerCase()}`, 'AudienceChallenge', id, {
        after: { decision: input.decision, reason: input.reason },
      });
      return { data: challenge };
    },
  );

  // --- production ----------------------------------------------------------

  app.post(
    '/admin/:id/open-voting',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_CYCLE_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const { cycleId } = parseBody(request, z.object({ cycleId: z.string().optional() }));
      const challenge = await openForVoting(id, cycleId);
      await writeAudit(request, 'challenge.open_voting', 'AudienceChallenge', id);
      return { data: challenge };
    },
  );

  app.post(
    '/admin/cycles/:cycleId/promote',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_CYCLE_MANAGE)] },
    async (request) => {
      const { cycleId } = parseParams(request, cycleParamSchema);
      const result = await promoteTopChallenges(cycleId);
      await writeAudit(request, 'challenge.promote_top', 'ChallengeCycle', cycleId, {
        after: { promoted: result.promoted },
      });
      return { data: result };
    },
  );

  app.post(
    '/admin/:id/producer-review',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_SELECT)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const challenge = await sendToProducerReview(id);
      await writeAudit(request, 'challenge.producer_review', 'AudienceChallenge', id);
      return { data: challenge };
    },
  );

  app.post(
    '/admin/:id/select',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_SELECT)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const challenge = await selectChallenge(id, auth.userId);
      await writeAudit(request, 'challenge.select', 'AudienceChallenge', id);
      return { data: challenge };
    },
  );

  app.post(
    '/admin/:id/execute',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_EXECUTE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, executeChallengeSchema);
      const challenge = await markExecuted(id, input.resultNotes);
      await writeAudit(request, 'challenge.execute', 'AudienceChallenge', id, { after: input });
      return { data: challenge };
    },
  );

  app.post(
    '/admin/:id/complete',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CHALLENGE_EXECUTE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, executeChallengeSchema);
      const challenge = await markCompleted(id, input.resultNotes);
      await writeAudit(request, 'challenge.complete', 'AudienceChallenge', id, { after: input });
      return { data: challenge };
    },
  );
}
