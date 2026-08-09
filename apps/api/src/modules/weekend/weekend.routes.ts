import {
  completeSelectionSchema,
  configureRewardsSchema,
  createWeekendRoundSchema,
  idParamSchema,
  moderateSubmissionSchema,
  moderationQueueSchema,
  selectSubmissionSchema,
  shortlistSchema,
  weekendSubmissionSchema,
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
  addParticipationType,
  advanceRound,
  completeSelection,
  configureRewards,
  createRound,
  getCurrentRound,
  getMyEligibility,
  getRound,
  getSubmissionQueue,
  listRounds,
  moderateSubmission,
  selectSubmission,
  shortlistSubmissions,
  submitEntry,
  withdrawEntry,
} from './weekend.service.js';

const submissionParamSchema = z.object({ submissionId: z.string().min(1) });
const advanceSchema = z.object({
  to: z.enum([
    'SUBMIT',
    'MODERATION',
    'SHORTLIST',
    'PRODUCER_SELECTION',
    'SELECTED',
    'COMPLETED',
    'CANCELLED',
  ]),
});
const addTypeSchema = z.object({
  type: z.enum([
    'ASK_CONTESTANT',
    'VIDEO_QUESTION',
    'CHALLENGE_WINNER',
    'MINI_GAME',
    'VIRTUAL_AUDIENCE',
    'SPECIAL_INTERACTION',
  ]),
});

export async function weekendRoutes(app: FastifyInstance): Promise<void> {
  // --- reading -------------------------------------------------------------

  app.get('/current', { preHandler: [optionalAuthenticate] }, async (request) => {
    return { data: await getCurrentRound(request.auth?.userId ?? null) };
  });

  app.get('/eligibility', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { roundId } = parseQuery(request, z.object({ roundId: z.string().optional() }));
    return { data: await getMyEligibility(auth.userId, roundId) };
  });

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getRound(id, request.auth?.userId ?? null) };
  });

  // --- submitting ----------------------------------------------------------

  app.post(
    '/:id/submissions',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, weekendSubmissionSchema);
      const result = await submitEntry(id, auth.userId, input);
      return reply.status(201).send({ data: result });
    },
  );

  app.delete(
    '/submissions/:submissionId',
    { preHandler: [authenticate] },
    async (request) => {
      const auth = requireAuth(request);
      const { submissionId } = parseParams(request, submissionParamSchema);
      return { data: await withdrawEntry(submissionId, auth.userId) };
    },
  );

  // --- moderation ----------------------------------------------------------

  app.get(
    '/admin/:id/submissions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUBMISSION_MODERATE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const query = parseQuery(request, moderationQueueSchema);
      return { data: await getSubmissionQueue(id, query) };
    },
  );

  app.post(
    '/admin/submissions/:submissionId/moderate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SUBMISSION_MODERATE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { submissionId } = parseParams(request, submissionParamSchema);
      const input = parseBody(request, moderateSubmissionSchema);
      const submission = await moderateSubmission(
        submissionId,
        auth.userId,
        input.decision,
        input.reason,
      );
      await writeAudit(
        request,
        `weekend.${input.decision.toLowerCase()}`,
        'WeekendSubmission',
        submissionId,
        { after: { decision: input.decision, reason: input.reason } },
      );
      return { data: submission };
    },
  );

  // --- production ----------------------------------------------------------

  app.get(
    '/admin/list',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_MANAGE)] },
    async () => ({ data: await listRounds() }),
  );

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createWeekendRoundSchema);
      const round = await createRound(input, auth.userId);
      await writeAudit(request, 'weekend.create', 'WeekendRound', round.id, { after: input });
      return reply.status(201).send({ data: round });
    },
  );

  app.post(
    '/admin/:id/advance',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const { to } = parseBody(request, advanceSchema);
      const round = await advanceRound(id, to);
      await writeAudit(request, `weekend.advance.${to.toLowerCase()}`, 'WeekendRound', id);
      return { data: round };
    },
  );

  app.post(
    '/admin/:id/shortlist',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_SELECT)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { submissionIds } = parseBody(request, shortlistSchema);
      const result = await shortlistSubmissions(id, submissionIds, auth.userId);
      await writeAudit(request, 'weekend.shortlist', 'WeekendRound', id, {
        after: { submissionIds },
      });
      return { data: result };
    },
  );

  app.post(
    '/admin/:id/select',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_SELECT)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, selectSubmissionSchema);
      const round = await selectSubmission(id, input.submissionId, auth.userId, {
        position: input.position,
        notes: input.notes,
      });
      await writeAudit(request, 'weekend.select', 'WeekendRound', id, { after: input });
      return { data: round };
    },
  );

  app.post(
    '/admin/:id/complete',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_SELECT)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, completeSelectionSchema);
      const result = await completeSelection(id, input.submissionId, input.notes);
      await writeAudit(request, 'weekend.complete', 'WeekendRound', id, { after: input });
      return { data: result };
    },
  );

  /**
   * Authorising an in-person opportunity.
   *
   * Its own endpoint and its own permission, deliberately separate from the
   * rest of round management — nobody should be able to promise an appearance
   * as a side effect of editing a round.
   */
  app.post(
    '/admin/:id/rewards',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_PHYSICAL_REWARDS)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, configureRewardsSchema);
      const round = await configureRewards(id, auth.userId, input);
      await writeAudit(request, 'weekend.configure_rewards', 'WeekendRound', id, { after: input });
      return { data: round };
    },
  );

  app.post(
    '/admin/:id/participation-types',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WEEKEND_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const { type } = parseBody(request, addTypeSchema);
      await addParticipationType(id, type);
      await writeAudit(request, 'weekend.add_type', 'WeekendRound', id, { after: { type } });
      return { data: await getRound(id, null) };
    },
  );
}
