import type { NotificationEventKey } from '@reality/shared';

import { logger } from './logger.js';
import { prisma } from './prisma.js';

/**
 * The domain event bus.
 *
 * This exists so that a feature module can say *what happened* without knowing
 * who cares. The prediction service records that a prediction was resolved; it
 * does not import the notification service, does not know a template exists, and
 * does not change when the wording does. That direction of dependency is the
 * whole point — features depend on this, and the notification module depends on
 * features' events, never the reverse.
 *
 * ### Why events are written to a table
 *
 * An in-process emitter would be simpler, and would lose an event whenever the
 * process died between "the challenge was approved" and "the author was told" —
 * silently, with nothing to replay and nothing to inspect. Persisting the event
 * first makes the handoff durable: the row survives a crash, a failed fan-out is
 * visible in an admin queue, and retrying is re-reading a row rather than
 * reconstructing what happened from a log.
 *
 * The trade is that delivery is asynchronous and eventually consistent, which
 * for a notification is exactly right: nobody needs to be told within the same
 * transaction that produced the thing they are being told about.
 */

export interface DomainEventInput {
  event: NotificationEventKey;
  /** The prediction / redemption / submission the event is about. */
  entityId: string;
  /**
   * Distinguishes repeats of the same event on the same entity, e.g. a
   * challenge that trends again a week later. Omit for once-only events.
   */
  variant?: string;
  payload?: Record<string, unknown>;
}

export interface EmittedEvent {
  id: string;
  event: string;
  entityId: string;
  /** False when this exact event had already been recorded. */
  recorded: boolean;
  /**
   * Resolves once the background fan-out for this emit has finished.
   *
   * Production never awaits it — that is the whole point of dispatching in the
   * background. It exists so a test can assert on the *result* of the fan-out
   * rather than racing it, and so a future synchronous path has something to
   * wait on without reaching into the dispatcher.
   */
  settled: Promise<void>;
}

/**
 * `event:entityId[:variant]`.
 *
 * With the unique index on the column, this is what makes a feature safe to
 * retry: emitting the same happening twice records it once.
 */
export function eventDedupeKey(input: DomainEventInput): string {
  return input.variant
    ? `${input.event}:${input.entityId}:${input.variant}`
    : `${input.event}:${input.entityId}`;
}

/** Handlers registered at boot. Kept as an array so a second consumer can be added. */
type EventHandler = (event: { id: string }) => Promise<void>;
const handlers: EventHandler[] = [];

/**
 * Fan-outs currently in flight.
 *
 * Tracked because "fire and forget" still has to be forgotten *somewhere*. On
 * shutdown they should be allowed to finish rather than being cut off
 * mid-write, and in tests they must finish before the next case truncates the
 * tables underneath them — which otherwise deadlocks a TRUNCATE against a
 * half-written notification.
 */
const inFlight = new Set<Promise<void>>();

/** Waits for every queued fan-out to finish. */
export async function settleDomainEvents(): Promise<void> {
  // A handler can emit further work, so drain until the set stays empty.
  for (let pass = 0; pass < 10 && inFlight.size > 0; pass += 1) {
    await Promise.allSettled([...inFlight]);
  }
}

export function onDomainEvent(handler: EventHandler): void {
  handlers.push(handler);
}

/** Test hook: drop registered handlers so suites do not leak into each other. */
export function clearDomainEventHandlers(): void {
  handlers.length = 0;
}

/**
 * Records that something happened.
 *
 * Deliberately swallows its own failures. A notification is never important
 * enough to fail the action that caused it: if this throws, a producer's
 * approval of a challenge would roll back because the *telling* failed, which
 * is a far worse outcome than a missing notification.
 */
export async function emitDomainEvent(input: DomainEventInput): Promise<EmittedEvent | null> {
  const dedupeKey = eventDedupeKey(input);

  try {
    const created = await prisma.notificationEvent.create({
      data: {
        event: input.event,
        entityId: input.entityId,
        dedupeKey,
        payload: (input.payload ?? {}) as never,
      },
      select: { id: true, event: true, entityId: true },
    });

    // Fan out in the background. The caller is mid-request and should not wait
    // for a notification to be written, let alone for an email provider.
    const settled = dispatch(created.id);
    inFlight.add(settled);
    void settled.finally(() => inFlight.delete(settled));

    return { ...created, recorded: true, settled };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.notificationEvent.findUnique({
        where: { dedupeKey },
        select: { id: true, event: true, entityId: true },
      });
      // Already recorded, so nothing new to dispatch — but the caller still
      // gets a promise it can await unconditionally.
      return existing ? { ...existing, recorded: false, settled: Promise.resolve() } : null;
    }

    logger.error({ err: error, event: input.event }, 'failed to record domain event');
    return null;
  }
}

async function dispatch(eventId: string): Promise<void> {
  for (const handler of handlers) {
    try {
      await handler({ id: eventId });
    } catch (error) {
      logger.warn({ err: error, eventId }, 'domain event handler failed');
    }
  }
}

/** Runs registered handlers for an event id. Used by the retry sweep and tests. */
export async function dispatchEvent(eventId: string): Promise<void> {
  await dispatch(eventId);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
