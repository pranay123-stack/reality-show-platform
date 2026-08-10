import {
  analyticsPrivacySchema,
  analyticsRangeSchema,
  rebuildAnalyticsSchema,
  trackBatchSchema,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import { authenticate, optionalAuthenticate, requireAuth, requirePermission } from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseQuery } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import { dailyDedupeKey, setAnalyticsOptOut, trackMany } from './analytics.service.js';
import { aggregateRange } from './aggregation.js';
import { getEventBreakdown, getOverview } from './reporting.js';

/**
 * Analytics endpoints.
 *
 * The ingest accepts only the events a server cannot observe for itself — what
 * somebody looked at. Everything with a consequence is recorded server-side
 * from the action, so a client cannot inflate a number that matters by posting
 * it. That is why `trackBatchSchema` enumerates a short allow-list rather than
 * accepting an event name.
 */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Client ingest.
   *
   * Anonymous callers are accepted — a signed-out visitor browsing contestants
   * is real engagement — but they contribute no user identity, only a count.
   * Rate limited generously: a page render legitimately reports several views.
   */
  app.post(
    '/events',
    {
      preHandler: [optionalAuthenticate],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { events } = parseBody(request, trackBatchSchema);
      const userId = request.auth?.userId ?? null;
      const sessionId = request.auth?.sessionId ?? null;

      trackMany(
        events.map((event) => ({
          name: event.name,
          userId,
          sessionId,
          entityId: event.entityId ?? null,
          properties: event.properties,
          // A view is not countable per scroll: one per subject per day.
          dedupeKey: userId
            ? dailyDedupeKey(event.name, userId, event.entityId ?? null)
            : undefined,
        })),
      );

      // 202: the events are queued, not committed, and the client has no reason
      // to wait for a write it cannot act on.
      return reply.status(202).send({ data: { accepted: events.length } });
    },
  );

  /** The user's own privacy control. */
  app.patch('/me/privacy', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { optOut } = parseBody(request, analyticsPrivacySchema);
    const profile = await setAnalyticsOptOut(auth.userId, optOut);
    return { data: { optedOut: profile.analyticsOptOut } };
  });

  app.get('/me/privacy', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { prisma } = await import('../../core/prisma.js');
    const profile = await prisma.userProfile.findUnique({
      where: { userId: auth.userId },
      select: { analyticsOptOut: true },
    });
    return { data: { optedOut: profile?.analyticsOptOut ?? false } };
  });

  // --- operator reads ------------------------------------------------------

  app.get(
    '/admin/overview',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ANALYTICS_VIEW)] },
    async (request) => {
      const { days } = parseQuery(request, analyticsRangeSchema);
      return { data: await getOverview(days) };
    },
  );

  app.get(
    '/admin/events',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ANALYTICS_VIEW)] },
    async (request) => {
      const { days } = parseQuery(request, analyticsRangeSchema);
      return { data: await getEventBreakdown(days) };
    },
  );

  /**
   * Recompute a window.
   *
   * Aggregation is idempotent — a day is replaced, never added to — so this is
   * safe to run as often as an operator likes.
   */
  app.post(
    '/admin/rebuild',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.ANALYTICS_REBUILD)],
      config: { rateLimit: { max: 6, timeWindow: '1 hour' } },
    },
    async (request) => {
      const { days } = parseBody(request, rebuildAnalyticsSchema);
      const processed = await aggregateRange(days);
      await writeAudit(request, 'analytics.rebuild', 'AnalyticsAggregate', String(days), {
        after: { days, processed },
      });
      return { data: { days, processed } };
    },
  );
}
