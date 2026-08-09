import { idParamSchema } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  authenticate,
  optionalAuthenticate,
  requireAuth,
  requirePermission,
  requireVerifiedEmail,
} from '../../core/auth/guards.js';
import { PERMISSIONS, type PermissionKey } from '../../core/permissions.js';
import { parseBody, parseParams } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import {
  castRoundVote,
  closeRound,
  createRound,
  getCurrentRound,
  getRound,
  listRounds,
  openRound,
  publishAudienceResult,
  publishOfficialOutcome,
  setCandidateEligibility,
  withdrawRoundVote,
  type RoundType,
} from './rounds.service.js';

const voteSchema = z.object({ contestantId: z.string().min(1) });

const createRoundSchema = z.object({
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  episodeId: z.string().nullable().optional(),
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  maxVotesPerUser: z.number().int().min(1).max(20).optional(),
  voteMeaning: z.enum(['SAVE', 'EVICT']).optional(),
  weighting: z.record(z.number().positive()).nullable().optional(),
  contestantIds: z.array(z.string().min(1)).min(2).max(30),
});

const eligibilitySchema = z.object({
  contestantId: z.string().min(1),
  eligible: z.boolean(),
});

const officialOutcomeSchema = z.object({
  contestantIds: z.array(z.string().min(1)).min(1).max(10),
  note: z.string().trim().max(500).optional(),
});

/**
 * One router, registered twice — once for nominations and once for evictions.
 * They are separate systems with separate data; sharing the routing shape keeps
 * their behaviour identical without duplicating it.
 */
export function buildRoundRoutes(type: RoundType, managePermission: PermissionKey) {
  return async function roundRoutes(app: FastifyInstance): Promise<void> {
    app.get('/current', { preHandler: [optionalAuthenticate] }, async (request) => {
      return { data: await getCurrentRound(type, request.auth?.userId ?? null) };
    });

    app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
      const { id } = parseParams(request, idParamSchema);
      return { data: await getRound(type, id, request.auth?.userId ?? null) };
    });

    app.post(
      '/:id/votes',
      {
        preHandler: [authenticate, requireVerifiedEmail],
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      },
      async (request) => {
        const auth = requireAuth(request);
        const { id } = parseParams(request, idParamSchema);
        const { contestantId } = parseBody(request, voteSchema);
        return { data: await castRoundVote(type, id, auth.userId, contestantId) };
      },
    );

    app.delete('/:id/votes', { preHandler: [authenticate] }, async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { contestantId } = parseBody(request, voteSchema);
      return { data: await withdrawRoundVote(type, id, auth.userId, contestantId) };
    });

    // --- operator ----------------------------------------------------------

    app.get(
      '/admin/list',
      { preHandler: [authenticate, requirePermission(managePermission)] },
      async () => ({ data: await listRounds(type) }),
    );

    app.post(
      '/admin',
      { preHandler: [authenticate, requirePermission(managePermission)] },
      async (request, reply) => {
        const auth = requireAuth(request);
        const input = parseBody(request, createRoundSchema);
        const round = await createRound(type, input, auth.userId);
        await writeAudit(request, `${type.toLowerCase()}.create`, `${type}Round`, round.id, {
          after: input,
        });
        return reply.status(201).send({ data: round });
      },
    );

    app.patch(
      '/admin/:id/eligibility',
      { preHandler: [authenticate, requirePermission(managePermission)] },
      async (request) => {
        const { id } = parseParams(request, idParamSchema);
        const input = parseBody(request, eligibilitySchema);
        const candidate = await setCandidateEligibility(type, id, input.contestantId, input.eligible);
        await writeAudit(request, `${type.toLowerCase()}.eligibility`, `${type}Round`, id, {
          after: input,
        });
        return { data: candidate };
      },
    );

    app.post(
      '/admin/:id/open',
      { preHandler: [authenticate, requirePermission(managePermission)] },
      async (request) => {
        const { id } = parseParams(request, idParamSchema);
        const round = await openRound(type, id);
        await writeAudit(request, `${type.toLowerCase()}.open`, `${type}Round`, id);
        return { data: round };
      },
    );

    app.post(
      '/admin/:id/close',
      { preHandler: [authenticate, requirePermission(managePermission)] },
      async (request) => {
        const { id } = parseParams(request, idParamSchema);
        const result = await closeRound(type, id);
        await writeAudit(request, `${type.toLowerCase()}.close`, `${type}Round`, id);
        return { data: result };
      },
    );

    /** Publishes what the audience voted for. Never an elimination. */
    app.post(
      '/admin/:id/publish-audience-result',
      { preHandler: [authenticate, requirePermission(PERMISSIONS.ROUND_PUBLISH)] },
      async (request) => {
        const auth = requireAuth(request);
        const { id } = parseParams(request, idParamSchema);
        const round = await publishAudienceResult(type, id, auth.userId);
        await writeAudit(request, `${type.toLowerCase()}.publish_audience`, `${type}Round`, id);
        return { data: round };
      },
    );

    /**
     * Records the show's official outcome. Deliberately a different endpoint,
     * a different permission and a different column from the audience result —
     * nothing here is derived from the vote.
     */
    app.post(
      '/admin/:id/publish-official-outcome',
      { preHandler: [authenticate, requirePermission(PERMISSIONS.OFFICIAL_OUTCOME_PUBLISH)] },
      async (request) => {
        const auth = requireAuth(request);
        const { id } = parseParams(request, idParamSchema);
        const input = parseBody(request, officialOutcomeSchema);
        const round = await publishOfficialOutcome(type, id, auth.userId, input);
        await writeAudit(request, `${type.toLowerCase()}.publish_official`, `${type}Round`, id, {
          after: input,
        });
        return { data: round };
      },
    );
  };
}

export const nominationRoutes = buildRoundRoutes('NOMINATION', PERMISSIONS.NOMINATION_MANAGE);
export const evictionRoutes = buildRoundRoutes('EVICTION', PERMISSIONS.EVICTION_MANAGE);
