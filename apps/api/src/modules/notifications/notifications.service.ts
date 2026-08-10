import type { Prisma } from '@prisma/client';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NOTIFICATION_TYPE_LABELS,
  type DeliveryHealthView,
  type NotificationChannel,
  type NotificationEventKey,
  type NotificationFeedView,
  type NotificationHealthView,
  type NotificationPreferenceView,
  type NotificationType,
  type NotificationView,
} from '@reality/shared';

import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';
import { providerFor } from './channels.js';
import { defaultTemplateFor, render } from './templates.js';

/**
 * The notification service.
 *
 * Its whole job is turning "this happened" into "these people were told", and
 * every rule it enforces exists to stop that becoming a spam cannon:
 *
 *  - **One notification per (event, entity, user).** Enforced by a unique index,
 *    not by a check, so a thousand simultaneous duplicates still yield one row.
 *  - **Preferences are consulted before writing, per channel.** A muted feature
 *    produces no in-app row at all, rather than a hidden one.
 *  - **A recipient list is derived, never supplied.** No caller anywhere can
 *    name who gets notified; the audience comes from the event catalogue and the
 *    data. That is what makes "unauthorised notification creation" impossible
 *    rather than merely guarded.
 */

/**
 * Keeps a rendered link navigable and harmless.
 *
 * Templates are editable data and their placeholders are filled from event
 * payloads, so a link can be influenced by more than one party. Rather than
 * trusting either, the rendered value is re-checked here: an in-app path or an
 * http(s) URL survives, everything else — `javascript:`, `data:`,
 * protocol-relative `//evil.example` — becomes no link at all.
 */
function safeNotificationLink(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (trimmed.startsWith('/')) return trimmed.slice(0, 500);

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed.slice(0, 500) : null;
  } catch {
    return null;
  }
}

const MAX_ATTEMPTS = 5;
/** Exponential, in seconds: ~1m, 5m, 25m, 2h. */
const RETRY_BACKOFF_SECONDS = 60;

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

interface Recipient {
  userId: string;
  /** Merged into the payload for this specific person, e.g. their new rank. */
  values?: Record<string, unknown>;
}

/**
 * Works out who an event is addressed to.
 *
 * Deliberately the only place a recipient list is produced. `broadcast` is the
 * expensive branch and is capped: an event that would notify a million accounts
 * is a decision, not an accident, and the cap makes the ceiling visible.
 */
const BROADCAST_CAP = 5000;

async function recipientsFor(
  event: NotificationEventKey,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<Recipient[]> {
  const audience = NOTIFICATION_EVENTS[event]?.audience ?? 'actor';

  if (audience === 'actor' || audience === 'author') {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    return userId ? [{ userId }] : [];
  }

  if (audience === 'participants') {
    const ids = Array.isArray(payload.userIds)
      ? (payload.userIds.filter((id) => typeof id === 'string') as string[])
      : await participantsFor(event, entityId);
    return ids.map((userId) => ({ userId }));
  }

  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, emailVerifiedAt: { not: null } },
    select: { id: true },
    take: BROADCAST_CAP,
  });
  return users.map((user) => ({ userId: user.id }));
}

/** Who took part in the thing the event is about. */
async function participantsFor(event: NotificationEventKey, entityId: string): Promise<string[]> {
  if (event.startsWith('prediction.')) {
    const entries = await prisma.predictionEntry.findMany({
      where: { predictionId: entityId },
      select: { userId: true },
    });
    return entries.map((entry) => entry.userId);
  }

  if (event.startsWith('kitchen.')) {
    const votes = await prisma.kitchenVote.findMany({
      where: { decisionId: entityId },
      select: { userId: true },
      distinct: ['userId'],
    });
    return votes.map((vote) => vote.userId);
  }

  return [];
}

export interface FanoutResult {
  eventId: string;
  created: number;
  skipped: number;
}

/**
 * Turns a recorded event into notifications.
 *
 * Safe to call repeatedly on the same event: every write is guarded by the
 * dedupe key, so a retry after a partial failure completes the job rather than
 * duplicating the part that already worked.
 */
export async function processEvent(eventId: string): Promise<FanoutResult> {
  const record = await prisma.notificationEvent.findUnique({ where: { id: eventId } });
  if (!record) return { eventId, created: 0, skipped: 0 };
  if (record.status === 'PROCESSED') return { eventId, created: 0, skipped: 0 };

  const event = record.event as NotificationEventKey;
  const payload = (record.payload ?? {}) as Record<string, unknown>;

  try {
    const template = await templateFor(event);
    const recipients = await recipientsFor(event, record.entityId, payload);

    let created = 0;
    let skipped = 0;

    for (const recipient of recipients) {
      const outcome = await deliverTo(recipient, {
        event,
        eventId: record.id,
        entityId: record.entityId,
        eventKey: record.dedupeKey,
        payload,
        template,
      });
      if (outcome === 'created') created += 1;
      else skipped += 1;
    }

    await prisma.notificationEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        fanout: created,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    return { eventId, created, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error, eventId, event: record.event }, 'notification fan-out failed');

    await prisma.notificationEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: message.slice(0, 500),
      },
    });

    return { eventId, created: 0, skipped: 0 };
  }
}

interface DeliveryContext {
  event: NotificationEventKey;
  eventId: string;
  entityId: string;
  /**
   * The event's own dedupe key, which already encodes any variant.
   *
   * Using it here rather than rebuilding `event:entityId` is what lets a
   * genuinely repeated happening — a challenge trending again next week — reach
   * the user twice, while a replay of the *same* happening still reaches them
   * once. Keying on `event:entityId` alone silently collapsed the two.
   */
  eventKey: string;
  payload: Record<string, unknown>;
  template: { type: NotificationType; title: string; body: string; link?: string | null };
}

async function deliverTo(
  recipient: Recipient,
  context: DeliveryContext,
): Promise<'created' | 'skipped'> {
  const preference = await preferenceFor(recipient.userId, context.template.type);

  // Nothing enabled anywhere means nothing is written. A muted notification
  // should not exist, not merely be hidden.
  const channels = NOTIFICATION_CHANNELS.filter((channel) => preference[channel]);
  if (channels.length === 0) return 'skipped';

  const values = {
    ...context.payload,
    ...recipient.values,
    entityId: context.entityId,
  };

  const dedupeKey = `${context.eventKey}:${recipient.userId}`;

  // A template's link is rendered with values from the event payload, so the
  // *rendered* result is what has to be safe, not the template. Anything that
  // is not an in-app path or an http(s) URL is dropped rather than stored.
  const renderedLink = context.template.link ? render(context.template.link, values) : null;
  const link = safeNotificationLink(renderedLink);

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: recipient.userId,
        type: context.template.type,
        event: context.event,
        eventId: context.eventId,
        title: render(context.template.title, values),
        body: render(context.template.body, values),
        link,
        data: values as never,
        dedupeKey,
        deliveries: {
          create: channels.map((channel) => ({ channel })),
        },
      },
      include: { deliveries: true },
    });

    await Promise.all(
      notification.deliveries.map((delivery) =>
        attemptDelivery(delivery.id).catch((error) =>
          logger.warn({ err: error, deliveryId: delivery.id }, 'delivery attempt threw'),
        ),
      ),
    );

    return 'created';
  } catch (error) {
    // The unique index did its job: this person has already been told.
    if (isUniqueViolation(error)) return 'skipped';
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Channel delivery
// ---------------------------------------------------------------------------

export async function attemptDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      notification: {
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!delivery || delivery.status === 'SENT' || delivery.status === 'SKIPPED') return;

  if (delivery.attemptCount >= MAX_ATTEMPTS) {
    // Give up loudly rather than retrying forever; the admin queue shows it.
    return;
  }

  const provider = providerFor(delivery.channel);
  const notification = delivery.notification;

  let outcome;
  try {
    outcome = await provider.send({
      userId: notification.userId,
      email: notification.user.email,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      data: (notification.data ?? {}) as Record<string, unknown>,
    });
  } catch (error) {
    outcome = {
      status: 'FAILED' as const,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }

  const attemptCount = delivery.attemptCount + 1;

  if (outcome.status === 'SENT') {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SENT', attemptCount, deliveredAt: new Date(), lastError: null, nextAttemptAt: null },
    });
    return;
  }

  if (outcome.status === 'SKIPPED') {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SKIPPED', attemptCount, lastError: outcome.reason, nextAttemptAt: null },
    });
    return;
  }

  const exhausted = attemptCount >= MAX_ATTEMPTS || !outcome.retryable;
  await prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'FAILED',
      attemptCount,
      lastError: outcome.error.slice(0, 500),
      // A non-retryable failure gets no next attempt: retrying a bad address
      // forever is how a queue becomes permanently red.
      nextAttemptAt: exhausted
        ? null
        : new Date(Date.now() + RETRY_BACKOFF_SECONDS * 1000 * 5 ** (attemptCount - 1)),
    },
  });
}

/** Retries failures whose backoff has elapsed. Called by the sweep and by admins. */
export async function retryPendingDeliveries(limit = 100): Promise<number> {
  const due = await prisma.notificationDelivery.findMany({
    where: {
      status: 'FAILED',
      attemptCount: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { lte: new Date() },
    },
    select: { id: true },
    take: limit,
  });

  for (const delivery of due) await attemptDelivery(delivery.id);
  return due.length;
}

/** Re-runs events whose fan-out failed. */
export async function retryFailedEvents(limit = 50): Promise<number> {
  const failed = await prisma.notificationEvent.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  for (const event of failed) await processEvent(event.id);
  return failed.length;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

type ChannelFlags = Record<NotificationChannel, boolean>;

/**
 * Defaults chosen so a new account is useful rather than noisy: everything
 * in-app, nothing by email or push until the user asks for it.
 */
const DEFAULT_FLAGS: ChannelFlags = { IN_APP: true, EMAIL: false, PUSH: false };

async function preferenceFor(userId: string, type: NotificationType): Promise<ChannelFlags> {
  const stored = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  if (!stored) return DEFAULT_FLAGS;
  return { IN_APP: stored.inApp, EMAIL: stored.email, PUSH: stored.push };
}

export async function listPreferences(userId: string): Promise<NotificationPreferenceView[]> {
  const stored = await prisma.notificationPreference.findMany({ where: { userId } });
  const byType = new Map(stored.map((row) => [row.type, row]));

  return NOTIFICATION_TYPES.map((type) => {
    const row = byType.get(type);
    return {
      type,
      label: NOTIFICATION_TYPE_LABELS[type],
      description: NOTIFICATION_TYPE_DESCRIPTIONS[type],
      inApp: row?.inApp ?? DEFAULT_FLAGS.IN_APP,
      email: row?.email ?? DEFAULT_FLAGS.EMAIL,
      push: row?.push ?? DEFAULT_FLAGS.PUSH,
    };
  });
}

export async function updatePreferences(
  userId: string,
  updates: { type: NotificationType; inApp?: boolean; email?: boolean; push?: boolean }[],
): Promise<NotificationPreferenceView[]> {
  for (const update of updates) {
    const current = await preferenceFor(userId, update.type);
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: update.type } },
      create: {
        userId,
        type: update.type,
        inApp: update.inApp ?? current.IN_APP,
        email: update.email ?? current.EMAIL,
        push: update.push ?? current.PUSH,
      },
      update: {
        ...(update.inApp !== undefined ? { inApp: update.inApp } : {}),
        ...(update.email !== undefined ? { email: update.email } : {}),
        ...(update.push !== undefined ? { push: update.push } : {}),
      },
    });
  }

  return listPreferences(userId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function toView(notification: {
  id: string;
  type: string;
  event: string;
  title: string;
  body: string;
  link: string | null;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: notification.id,
    type: notification.type as NotificationType,
    event: notification.event,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    data: (notification.data ?? null) as Record<string, unknown> | null,
    read: notification.readAt !== null,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; type?: NotificationType; limit: number; cursor?: string },
): Promise<NotificationFeedView> {
  const where: Prisma.NotificationWhereInput = {
    userId,
    channel: 'IN_APP',
    ...(options.unreadOnly ? { readAt: null } : {}),
    ...(options.type ? { type: options.type } : {}),
  };

  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const items = (hasMore ? rows.slice(0, options.limit) : rows).map(toView);

  return {
    items,
    unreadCount: await unreadCount(userId),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

export function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null, channel: 'IN_APP' } });
}

/**
 * Marks notifications read.
 *
 * Scoped to the caller's own rows by the `where`, so an id belonging to someone
 * else simply matches nothing — there is no path here to touch another user's
 * feed, and no 403 to leak whether that id exists.
 */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

async function templateFor(event: NotificationEventKey) {
  const fallback = defaultTemplateFor(event);

  const stored = await prisma.notificationTemplate
    .findUnique({ where: { event } })
    .catch(() => null);

  if (!stored || !stored.active) {
    return { type: fallback.type, title: fallback.title, body: fallback.body, link: fallback.link };
  }

  return {
    type: stored.type as NotificationType,
    title: stored.titleTemplate,
    body: stored.bodyTemplate,
    link: stored.linkTemplate ?? fallback.link ?? null,
  };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function notificationHealth(windowHours: number): Promise<NotificationHealthView> {
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const [eventCounts, created, read, deliveries, recentFailures, stuckEvents] = await Promise.all([
    prisma.notificationEvent.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
    prisma.notification.count({ where: { createdAt: { gte: since } } }),
    prisma.notification.count({ where: { createdAt: { gte: since }, readAt: { not: null } } }),
    prisma.notificationDelivery.groupBy({
      by: ['channel', 'status'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
    prisma.notificationDelivery.findMany({
      where: { status: 'FAILED', createdAt: { gte: since } },
      include: { notification: { select: { event: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.notificationEvent.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
  ]);

  const eventTotal = (status: string) =>
    eventCounts.find((row) => row.status === status)?._count ?? 0;

  const channels: DeliveryHealthView[] = NOTIFICATION_CHANNELS.map((channel) => {
    const forChannel = deliveries.filter((row) => row.channel === channel);
    const count = (status: string) =>
      forChannel.find((row) => row.status === status)?._count ?? 0;

    return {
      channel,
      available: providerFor(channel).isAvailable(),
      pending: count('PENDING'),
      sent: count('SENT'),
      failed: count('FAILED'),
      skipped: count('SKIPPED'),
    };
  });

  return {
    windowHours,
    events: {
      pending: eventTotal('PENDING'),
      processed: eventTotal('PROCESSED'),
      failed: eventTotal('FAILED'),
    },
    notifications: { created, read },
    channels,
    recentFailures: recentFailures.map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      attemptCount: delivery.attemptCount,
      lastError: delivery.lastError,
      notificationId: delivery.notificationId,
      event: delivery.notification.event,
      createdAt: delivery.createdAt.toISOString(),
    })),
    stuckEvents: stuckEvents.map((event) => ({
      id: event.id,
      event: event.event,
      entityId: event.entityId,
      attempts: event.attempts,
      lastError: event.lastError,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Admin retry. Resets the backoff so an operator does not have to wait for it. */
export async function resendDeliveries(deliveryIds?: string[]): Promise<number> {
  const failures = await prisma.notificationDelivery.findMany({
    where: {
      status: 'FAILED',
      ...(deliveryIds && deliveryIds.length > 0 ? { id: { in: deliveryIds } } : {}),
    },
    select: { id: true },
    take: 500,
  });

  await prisma.notificationDelivery.updateMany({
    where: { id: { in: failures.map((row) => row.id) } },
    data: { nextAttemptAt: new Date(), attemptCount: 0 },
  });

  for (const failure of failures) await attemptDelivery(failure.id);
  return failures.length;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
