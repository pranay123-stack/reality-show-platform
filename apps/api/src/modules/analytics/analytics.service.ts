import type { AnalyticsEventName } from '@reality/shared';

import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';

/**
 * Analytics ingest.
 *
 * The contract every caller relies on: **recording an event can never fail the
 * thing that produced it.** Every function here swallows its own errors. A vote
 * that succeeded must not be reported as failed because an observation could
 * not be written, and a analytics outage must not become a platform outage.
 *
 * That is also why nothing here returns a value the caller acts on.
 */

/**
 * Writes currently in flight.
 *
 * `track` is fire-and-forget, which means somebody has to be able to wait for
 * it: a graceful shutdown should not cut a write in half, and a test that
 * truncates the table while a write is pending will deadlock against its own
 * TRUNCATE. Exactly the problem the domain event bus has, solved the same way.
 */
const inFlight = new Set<Promise<void>>();

/** Waits for every queued write to finish. */
export async function settleAnalytics(): Promise<void> {
  for (let pass = 0; pass < 5 && inFlight.size > 0; pass += 1) {
    await Promise.allSettled([...inFlight]);
  }
}

export interface TrackInput {
  name: AnalyticsEventName;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  showId?: string | null;
  /** The prediction / poll / contestant the event is about. */
  entityId?: string | null;
  properties?: Record<string, unknown>;
  /**
   * Distinguishes repeats of the same happening. Omit for events that are
   * genuinely countable each time (a vote), supply one for events that are not
   * (a view, which fires on every scroll).
   */
  dedupeKey?: string;
  occurredAt?: Date;
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * Keys that must never be stored, whatever a caller passes.
 *
 * Matched as substrings on the lower-cased key, so `userEmail`, `EMAIL_ADDRESS`
 * and `auth_token` are all caught. A deny-list is the wrong shape for a security
 * boundary, but this is not one: the schema already narrows client input to a
 * flat bag of short scalars, and this is the second layer that catches a
 * server-side caller passing something thoughtlessly.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'session',
  'email',
  'phone',
  'address',
  'ip',
  'hash',
  'credential',
  'card',
];

/** A property value long enough to be free-form user text is not context. */
const MAX_VALUE_LENGTH = 120;
const MAX_PROPERTIES = 12;

export function sanitiseProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!properties) return {};

  const clean: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (Object.keys(clean).length >= MAX_PROPERTIES) break;

    const lowered = key.toLowerCase();
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment))) continue;

    if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) clean[key] = value;
    // Anything else — objects, arrays, long strings, null — is dropped rather
    // than coerced. Analytics context should be small and flat by construction.
  }

  return clean;
}

/**
 * Whether this user has opted out.
 *
 * Cached briefly: the ingest path runs on every vote and view, and a database
 * read per event to answer a question that changes once a year would be the
 * most expensive thing about analytics.
 */
const OPT_OUT_TTL_MS = 60_000;
const optOutCache = new Map<string, { optedOut: boolean; expiresAt: number }>();

export function clearOptOutCache(): void {
  optOutCache.clear();
}

async function hasOptedOut(userId: string): Promise<boolean> {
  const cached = optOutCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.optedOut;

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { analyticsOptOut: true },
  });
  const optedOut = profile?.analyticsOptOut ?? false;

  optOutCache.set(userId, { optedOut, expiresAt: Date.now() + OPT_OUT_TTL_MS });
  return optedOut;
}

export async function setAnalyticsOptOut(userId: string, optOut: boolean) {
  const profile = await prisma.userProfile.update({
    where: { userId },
    data: { analyticsOptOut: optOut },
    select: { analyticsOptOut: true },
  });

  optOutCache.set(userId, { optedOut: profile.analyticsOptOut, expiresAt: Date.now() + OPT_OUT_TTL_MS });

  // Opting out is retrospective: what was already collected is deleted, not
  // merely stopped. An opt-out that leaves a year of history behind is not one.
  if (optOut) {
    await prisma.analyticsEvent.deleteMany({ where: { userId } });
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Records one event.
 *
 * Fire-and-forget by design — callers do `void track(...)` — so the only signal
 * of a problem is a log line, never a thrown error reaching a user's request.
 */
export function track(input: TrackInput): Promise<void> {
  const write = record(input);
  inFlight.add(write);
  void write.finally(() => inFlight.delete(write));
  return write;
}

async function record(input: TrackInput): Promise<void> {
  try {
    if (input.userId && (await hasOptedOut(input.userId))) return;

    const properties = sanitiseProperties({
      ...input.properties,
      ...(input.entityId ? { entityId: input.entityId } : {}),
    });

    await prisma.analyticsEvent.create({
      data: {
        name: input.name,
        userId: input.userId ?? null,
        anonymousId: input.anonymousId ?? null,
        sessionId: input.sessionId ?? null,
        showId: input.showId ?? null,
        properties: properties as never,
        dedupeKey: input.dedupeKey ?? null,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
    });
  } catch (error) {
    // A duplicate is the dedupe key doing its job, not a failure worth logging.
    if (isUniqueViolation(error)) return;
    logger.warn({ err: error, event: input.name }, 'analytics event not recorded');
  }
}

/** One event per subject per day — the shape a view event needs. */
export function dailyDedupeKey(
  name: AnalyticsEventName,
  subject: string,
  entityId: string | null,
  at = new Date(),
): string {
  const day = at.toISOString().slice(0, 10);
  return `${name}:${subject}:${entityId ?? '-'}:${day}`;
}

export function trackMany(events: TrackInput[]): void {
  for (const event of events) void track(event);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
