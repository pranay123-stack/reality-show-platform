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
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseParams, parseQuery } from '../../core/validation.js';
import { rooms } from '../../realtime/events.js';
import { getBroadcaster, liveNamespace } from '../../realtime/server.js';
import { writeAudit } from '../audit/audit.service.js';
import {
  activatePoll,
  castVote,
  closePoll,
  countsOf,
  createPoll,
  getPollForViewer,
  listPolls,
  listPollsForAdmin,
  pausePoll,
  publishPollResult,
  toSnapshot,
  winningOptionId,
} from './polls.service.js';

const createPollSchema = z.object({
  question: z.string().trim().min(5).max(240),
  description: z.string().trim().max(500).nullable().optional(),
  episodeId: z.string().optional().nullable(),
  durationSeconds: z.number().int().min(10).max(3600).optional(),
  participationPoints: z.number().int().min(0).max(100).optional(),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        contestantId: z.string().nullable().optional(),
        sortOrder: z.number().int().min(0).max(50).optional(),
      }),
    )
    .min(2)
    .max(10),
});

const votePollSchema = z.object({ optionId: z.string().min(1) });
const listQuerySchema = z.object({ scope: z.enum(['active', 'past', 'all']).default('active') });

export async function pollRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Operator list, including drafts. Registered before `/:id` so `/admin` is
   * never read as a poll id.
   */
  app.get(
    '/admin/list',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POLL_CREATE)] },
    async (request) => {
      const auth = requireAuth(request);
      return { data: await listPollsForAdmin(auth.userId) };
    },
  );

  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { scope } = parseQuery(request, listQuerySchema);
    return { data: await listPolls(request.auth?.userId ?? null, scope) };
  });

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getPollForViewer(id, request.auth?.userId ?? null) };
  });

  /**
   * HTTP voting exists alongside the socket path so the feature degrades
   * gracefully: a client behind a proxy that blocks WebSockets can still take
   * part, and the same server-side rules apply either way.
   */
  app.post(
    '/:id/vote',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { optionId } = parseBody(request, votePollSchema);

      const result = await castVote(id, auth.userId, optionId);

      getBroadcaster()?.queue(id, {
        counts: result.counts,
        totalVotes: result.totalVotes,
        version: result.version,
      });

      return { data: result };
    },
  );

  // --- operator lifecycle --------------------------------------------------

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POLL_CREATE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createPollSchema);
      const poll = await createPoll(input, auth.userId);
      await writeAudit(request, 'poll.create', 'LivePoll', poll.id, { after: input });
      return reply.status(201).send({ data: toSnapshot(poll, true) });
    },
  );

  app.post(
    '/admin/:id/activate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POLL_ACTIVATE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const poll = await activatePoll(id);
      await writeAudit(request, 'poll.activate', 'LivePoll', id);

      // Counts are withheld from the start frame; the poll has just opened and
      // nobody has voted, so there is nothing to reveal anyway.
      liveNamespace()
        ?.to(rooms.show(poll.showId))
        .emit('poll:started', { poll: toSnapshot(poll, false) });

      return { data: toSnapshot(poll, true) };
    },
  );

  app.post(
    '/admin/:id/pause',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POLL_PAUSE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const poll = await pausePoll(id);
      await writeAudit(request, 'poll.pause', 'LivePoll', id);

      liveNamespace()?.to(rooms.poll(id)).emit('poll:paused', { pollId: id, version: poll.version });
      return { data: toSnapshot(poll, true) };
    },
  );

  app.post(
    '/admin/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POLL_CLOSE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const { poll, alreadyClosed } = await closePoll(id);
      if (!alreadyClosed) await writeAudit(request, 'poll.close', 'LivePoll', id);

      // Once a poll is closed the split is public, so every spectator is moved
      // into the voters' room before the final tally is flushed.
      const namespace = liveNamespace();
      if (namespace) {
        const sockets = await namespace.in(rooms.poll(id)).fetchSockets();
        await Promise.all(sockets.map((socket) => socket.join(rooms.pollVoters(id))));
      }

      // Any queued tally is sent before the close frame, so a client never sees
      // "closed" followed by a stale count arriving after it.
      getBroadcaster()?.flushNow(id);
      liveNamespace()?.to(rooms.poll(id)).emit('poll:closed', {
        pollId: id,
        closedAt: (poll.closedAt ?? new Date()).toISOString(),
        version: poll.version,
      });

      return { data: { ...toSnapshot(poll, true), alreadyClosed } };
    },
  );

  app.post(
    '/admin/:id/publish',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POLL_PUBLISH)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const poll = await publishPollResult(id);
      await writeAudit(request, 'poll.publish', 'LivePoll', id);

      liveNamespace()?.to(rooms.poll(id)).emit('poll:result', {
        pollId: id,
        counts: countsOf(poll),
        totalVotes: poll.totalVotes,
        winningOptionId: winningOptionId(poll),
        version: poll.version,
      });

      return {
        data: { ...toSnapshot(poll, true), winningOptionId: winningOptionId(poll) },
      };
    },
  );
}
