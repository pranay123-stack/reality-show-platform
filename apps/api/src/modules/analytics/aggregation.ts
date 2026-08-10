import type { AnalyticsEventName, AnalyticsMetric } from '@reality/shared';

import { logger } from '../../core/logger.js';
import { prisma } from '../../core/prisma.js';

/**
 * The aggregation pass.
 *
 * Turns the raw event log into the handful of numbers a dashboard reads. It is
 * the only thing in the system that scans `AnalyticsEvent`, it runs on a
 * schedule rather than on a request, and it is idempotent — recomputing a day
 * overwrites that day rather than adding to it, so a pass can be re-run as often
 * as an operator likes.
 *
 * Everything is computed from the event log alone. Reaching into the
 * transactional tables would be easier for one or two figures and would make
 * the dashboard a load source on the tables serving the live show, which is
 * exactly what this design exists to prevent.
 */

export function startOfDayUtc(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Which event proves participation in a feature. */
const PARTICIPATION_EVENTS: Record<string, AnalyticsEventName> = {
  prediction_participation: 'prediction_submitted',
  poll_participation: 'poll_voted',
  challenge_participation: 'challenge_voted',
  perspective_participation: 'perspective_voted',
  kitchen_participation: 'kitchen_voted',
  weekend_participation: 'weekend_submitted',
  reward_redemptions: 'reward_redeemed',
};

interface DayCounts {
  name: string;
  events: number;
  users: Set<string>;
}

/**
 * Aggregates one day.
 *
 * Reads that day's events once and derives every per-day metric from the same
 * pass, rather than issuing one query per metric.
 */
export async function aggregateDay(date: Date): Promise<number> {
  const start = startOfDayUtc(date);
  const end = addDays(start, 1);

  const events = await prisma.analyticsEvent.findMany({
    where: { occurredAt: { gte: start, lt: end } },
    select: { name: true, userId: true, properties: true },
  });

  const byName = new Map<string, DayCounts>();
  const activeUsers = new Set<string>();
  // Contestant views are the one metric with a meaningful breakdown.
  const contestantViews = new Map<string, { events: number; users: Set<string> }>();

  for (const event of events) {
    const bucket = byName.get(event.name) ?? { name: event.name, events: 0, users: new Set() };
    bucket.events += 1;
    if (event.userId) {
      bucket.users.add(event.userId);
      activeUsers.add(event.userId);
    }
    byName.set(event.name, bucket);

    if (event.name === 'contestant_viewed' || event.name === 'heat_viewed') {
      const entityId = (event.properties as { entityId?: unknown } | null)?.entityId;
      if (typeof entityId === 'string') {
        const row = contestantViews.get(entityId) ?? { events: 0, users: new Set<string>() };
        row.events += 1;
        if (event.userId) row.users.add(event.userId);
        contestantViews.set(entityId, row);
      }
    }
  }

  const rows: { metric: string; dimension: string; value: number; uniqueUsers: number }[] = [];

  // One row per raw event name, so a new event is charted without a code change.
  for (const [name, counts] of byName) {
    rows.push({ metric: `event:${name}`, dimension: '', value: counts.events, uniqueUsers: counts.users.size });
  }

  rows.push({ metric: 'dau', dimension: '', value: activeUsers.size, uniqueUsers: activeUsers.size });
  rows.push({
    metric: 'new_users',
    dimension: '',
    value: byName.get('signup')?.events ?? 0,
    uniqueUsers: byName.get('signup')?.users.size ?? 0,
  });
  rows.push({
    metric: 'sessions',
    dimension: '',
    value: byName.get('session_started')?.events ?? 0,
    uniqueUsers: byName.get('session_started')?.users.size ?? 0,
  });

  for (const [metric, eventName] of Object.entries(PARTICIPATION_EVENTS)) {
    const counts = byName.get(eventName);
    rows.push({
      metric,
      dimension: '',
      value: counts?.events ?? 0,
      uniqueUsers: counts?.users.size ?? 0,
    });
  }

  for (const [contestantId, counts] of contestantViews) {
    rows.push({
      metric: 'contestant_views',
      dimension: contestantId,
      value: counts.events,
      uniqueUsers: counts.users.size,
    });
  }

  // Points move through the ledger, not through events, and the ledger is small
  // and indexed by day — this is the one deliberate exception, and it reads a
  // single aggregate rather than scanning rows.
  const [earned, spent] = await Promise.all([
    prisma.pointsLedger.aggregate({
      where: { entryType: 'EARN', createdAt: { gte: start, lt: end } },
      _sum: { delta: true },
    }),
    prisma.pointsLedger.aggregate({
      where: { entryType: 'SPEND', createdAt: { gte: start, lt: end } },
      _sum: { delta: true },
    }),
  ]);
  rows.push({ metric: 'points_earned', dimension: '', value: earned._sum.delta ?? 0, uniqueUsers: 0 });
  rows.push({
    metric: 'points_spent',
    dimension: '',
    value: Math.abs(spent._sum.delta ?? 0),
    uniqueUsers: 0,
  });

  // Replace the day wholesale so a re-run corrects rather than accumulates.
  await prisma.$transaction([
    prisma.analyticsAggregate.deleteMany({ where: { date: start } }),
    prisma.analyticsAggregate.createMany({
      data: rows.map((row) => ({ ...row, date: start })),
    }),
  ]);

  return rows.length;
}

/**
 * Rolling windows and retention.
 *
 * These are not sums of daily values — a user active on three days counts once
 * in WAU — so they need their own pass over a window of days, and storing the
 * answer is what keeps the dashboard's first paint to a single row.
 */
export async function snapshotDay(date: Date): Promise<void> {
  const day = startOfDayUtc(date);
  const tomorrow = addDays(day, 1);

  const distinctUsersBetween = async (from: Date, to: Date): Promise<Set<string>> => {
    const rows = await prisma.analyticsEvent.findMany({
      where: { occurredAt: { gte: from, lt: to }, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return new Set(rows.map((row) => row.userId!).filter(Boolean));
  };

  const [today, week, month, yesterday, weekAgo] = await Promise.all([
    distinctUsersBetween(day, tomorrow),
    distinctUsersBetween(addDays(day, -6), tomorrow),
    distinctUsersBetween(addDays(day, -29), tomorrow),
    distinctUsersBetween(addDays(day, -1), day),
    distinctUsersBetween(addDays(day, -7), addDays(day, -6)),
  ]);

  /** Share of an earlier cohort that came back today, 0–100. */
  const returned = (cohort: Set<string>): number => {
    if (cohort.size === 0) return 0;
    let back = 0;
    for (const userId of cohort) if (today.has(userId)) back += 1;
    return Math.round((back / cohort.size) * 1000) / 10;
  };

  const aggregates = await prisma.analyticsAggregate.findMany({
    where: { date: day, dimension: '' },
    select: { metric: true, value: true, uniqueUsers: true },
  });
  const metricMap = Object.fromEntries(
    aggregates.map((row) => [row.metric, { value: row.value, uniqueUsers: row.uniqueUsers }]),
  );

  const sessions = metricMap.sessions?.value ?? 0;

  await prisma.analyticsSnapshot.upsert({
    where: { date: day },
    create: {
      date: day,
      dau: today.size,
      wau: week.size,
      mau: month.size,
      newUsers: metricMap.new_users?.value ?? 0,
      sessions,
      avgSessionSeconds: await averageSessionSeconds(day, tomorrow),
      retentionD1: returned(yesterday),
      retentionD7: returned(weekAgo),
      metrics: metricMap as never,
    },
    update: {
      dau: today.size,
      wau: week.size,
      mau: month.size,
      newUsers: metricMap.new_users?.value ?? 0,
      sessions,
      avgSessionSeconds: await averageSessionSeconds(day, tomorrow),
      retentionD1: returned(yesterday),
      retentionD7: returned(weekAgo),
      metrics: metricMap as never,
      computedAt: new Date(),
    },
  });
}

/**
 * Mean session length.
 *
 * Derived from the session rows the auth module already keeps rather than from
 * a bespoke pair of events: a session that ends with the browser closing emits
 * no `logout`, so an event-derived figure would silently only measure the
 * people who signed out deliberately.
 */
async function averageSessionSeconds(from: Date, to: Date): Promise<number> {
  const sessions = await prisma.userSession.findMany({
    // `lastSeenAt` is non-null by schema, so no filter is needed; the window is
    // what bounds the read.
    where: { createdAt: { gte: from, lt: to } },
    select: { createdAt: true, lastSeenAt: true },
    take: 5000,
  });

  if (sessions.length === 0) return 0;

  const total = sessions.reduce(
    (sum, session) => sum + Math.max(0, (session.lastSeenAt.getTime() - session.createdAt.getTime()) / 1000),
    0,
  );
  return Math.round(total / sessions.length);
}

/** Recomputes a window. Used by the scheduler and by the admin rebuild. */
export async function aggregateRange(days: number, endingAt = new Date()): Promise<number> {
  const end = startOfDayUtc(endingAt);
  let processed = 0;

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(end, -offset);
    try {
      await aggregateDay(day);
      await snapshotDay(day);
      processed += 1;
    } catch (error) {
      // One bad day must not abandon the rest of the window.
      logger.warn({ err: error, day: day.toISOString() }, 'analytics aggregation failed for a day');
    }
  }

  return processed;
}

export const METRIC_FORMATS: Record<string, 'count' | 'percent' | 'duration'> = {
  retention_d1: 'percent',
  retention_d7: 'percent',
  weekend_conversion: 'percent',
  feature_adoption: 'percent',
  avg_session_seconds: 'duration',
};

export function formatFor(metric: AnalyticsMetric | string): 'count' | 'percent' | 'duration' {
  return METRIC_FORMATS[metric] ?? 'count';
}
