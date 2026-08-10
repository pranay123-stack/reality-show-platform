import type { AnalyticsEventName } from '@reality/shared';

import { onDomainEvent } from '../../core/domain-events.js';
import { prisma } from '../../core/prisma.js';
import { track } from './analytics.service.js';

/**
 * Analytics on the domain event bus.
 *
 * The second consumer the bus was built for. Notifications subscribe to tell
 * people things; analytics subscribes to count them. Neither knows the other
 * exists, and no feature module knows about either — a feature emits
 * `challenge.approved` and is done.
 *
 * Only events whose *meaning* is a business outcome are mapped here. A view is
 * not a domain event and never will be; those arrive through the client ingest.
 */

/** Domain event → analytics event. Anything unmapped is deliberately ignored. */
const EVENT_MAP: Record<string, AnalyticsEventName> = {
  'challenge.selected': 'challenge_selected',
  'reward.redemption_created': 'reward_redeemed',
  'prediction.resolved': 'prediction_correct',
};

export function registerAnalyticsSubscriber(): void {
  onDomainEvent(async ({ id }) => {
    const record = await prisma.notificationEvent.findUnique({
      where: { id },
      select: { event: true, entityId: true, payload: true, createdAt: true },
    });
    if (!record) return;

    const name = EVENT_MAP[record.event];
    if (!name) return;

    const payload = (record.payload ?? {}) as Record<string, unknown>;

    // `prediction.resolved` addresses everyone who entered, so it becomes one
    // `prediction_correct` per participant rather than one for the prediction.
    if (name === 'prediction_correct') {
      const userIds = Array.isArray(payload.userIds)
        ? payload.userIds.filter((value): value is string => typeof value === 'string')
        : [];

      for (const userId of userIds) {
        void track({
          name,
          userId,
          entityId: record.entityId,
          // One per user per prediction, however many times the event replays.
          dedupeKey: `${name}:${userId}:${record.entityId}`,
          occurredAt: record.createdAt,
        });
      }
      return;
    }

    const userId = typeof payload.userId === 'string' ? payload.userId : null;

    void track({
      name,
      userId,
      entityId: record.entityId,
      dedupeKey: `${name}:${userId ?? 'anon'}:${record.entityId}`,
      occurredAt: record.createdAt,
    });
  });
}
