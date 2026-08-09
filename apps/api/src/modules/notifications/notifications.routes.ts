import {
  announcementSchema,
  listNotificationsQuerySchema,
  markReadSchema,
  notificationHealthQuerySchema,
  retryDeliverySchema,
  updatePreferencesSchema,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import { authenticate, requireAuth, requirePermission } from '../../core/auth/guards.js';
import { emitDomainEvent } from '../../core/domain-events.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseQuery } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import {
  listNotifications,
  listPreferences,
  markRead,
  notificationHealth,
  resendDeliveries,
  retryFailedEvents,
  unreadCount,
  updatePreferences,
} from './notifications.service.js';

/**
 * Notification routes.
 *
 * Note what is absent: there is no endpoint that creates a notification for a
 * named user. The only route that produces notifications at all is the
 * announcement below, which is permission-gated, audited, and cannot choose its
 * recipients — everything else arrives because something happened.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  // --- the user's own feed -------------------------------------------------

  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const query = parseQuery(request, listNotificationsQuerySchema);
    return { data: await listNotifications(auth.userId, query) };
  });

  /** Cheap enough for the bell to poll; deliberately not the full feed. */
  app.get('/unread-count', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: { count: await unreadCount(auth.userId) } };
  });

  app.post('/read', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { ids } = parseBody(request, markReadSchema);
    const updated = await markRead(auth.userId, ids);
    return { data: { updated, unreadCount: await unreadCount(auth.userId) } };
  });

  // --- preferences ---------------------------------------------------------

  app.get('/preferences', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: await listPreferences(auth.userId) };
  });

  app.patch('/preferences', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const { preferences } = parseBody(request, updatePreferencesSchema);
    return { data: await updatePreferences(auth.userId, preferences) };
  });

  // --- administration ------------------------------------------------------

  app.get(
    '/admin/health',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_INSPECT)] },
    async (request) => {
      const { hours } = parseQuery(request, notificationHealthQuerySchema);
      return { data: await notificationHealth(hours) };
    },
  );

  app.post(
    '/admin/retry',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_MANAGE)] },
    async (request) => {
      const { deliveryIds } = parseBody(request, retryDeliverySchema);
      const [deliveries, events] = await Promise.all([
        resendDeliveries(deliveryIds),
        // A failed fan-out leaves no delivery to retry, so the sweep covers both.
        deliveryIds ? Promise.resolve(0) : retryFailedEvents(),
      ]);

      await writeAudit(request, 'notification.retry', 'NotificationDelivery', 'batch', {
        after: { deliveries, events, targeted: deliveryIds?.length ?? null },
      });
      return { data: { deliveries, events } };
    },
  );

  /**
   * The one hand-authored notification in the system.
   *
   * It still goes through the event pipeline rather than writing rows directly,
   * so it is deduplicated, preference-respecting and visible in the same health
   * dashboard as everything else.
   */
  app.post(
    '/admin/announce',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_ANNOUNCE)],
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, announcementSchema);

      const emitted = await emitDomainEvent({
        event: 'system.announcement',
        entityId: auth.userId,
        // Two announcements with the same words are still two announcements.
        variant: String(Date.now()),
        payload: { title: input.title, body: input.body, link: input.link ?? null },
      });

      await writeAudit(request, 'notification.announce', 'NotificationEvent', emitted?.id ?? '', {
        after: input,
      });
      return reply.status(201).send({ data: { eventId: emitted?.id ?? null } });
    },
  );
}
