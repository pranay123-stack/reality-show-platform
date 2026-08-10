import type {
  AdminOverviewView,
  AuditEntryView,
  AuditFacetsView,
  AuditFeedView,
  AuditQueryInput,
  OverviewCard,
} from '@reality/shared';

import { prisma } from '../../core/prisma.js';
import { ROLE_PERMISSIONS, type PermissionKey } from '../../core/permissions.js';
import type { Role } from '@reality/shared';

/**
 * The operator console's own data.
 *
 * Deliberately thin. Every *action* the console performs goes to the endpoint
 * that already owns it — closing a poll is `POST /polls/admin/:id/close`, not a
 * second implementation living here. What this module adds is the two things
 * only an operator view needs: a cross-domain summary, and a reader for the
 * audit trail.
 *
 * The rule that keeps it thin: if a function here would contain a business
 * decision, it belongs in the feature module instead.
 */

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** Anything closing sooner than this is worth flagging on the overview. */
const IMMINENT_MS = 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which sections an operator may open.
 *
 * Sent to the client so the sidebar shows only what the caller can actually
 * use. The API still enforces every permission independently — this exists to
 * avoid presenting a door that will not open, not to provide security.
 */
const SECTION_PERMISSIONS: Record<string, PermissionKey[]> = {
  overview: [],
  contestants: ['contestant.manage'],
  predictions: ['prediction.create'],
  polls: ['poll.create'],
  challenges: ['challenge.moderate'],
  kitchen: ['kitchen.manage'],
  weekend: ['weekend.manage'],
  rewards: ['reward.view'],
  leaderboard: ['leaderboard.inspect'],
  analytics: ['analytics.view'],
  notifications: ['notification.inspect'],
  audit: ['audit.view'],
};

export function sectionsForRole(role: Role): string[] {
  const granted = new Set<string>(ROLE_PERMISSIONS[role]);
  return Object.entries(SECTION_PERMISSIONS)
    .filter(([, required]) => required.every((permission) => granted.has(permission)))
    .map(([section]) => section);
}

export async function getOverview(role: Role): Promise<AdminOverviewView> {
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  const show = await prisma.show.findFirst({
    where: { status: { in: ['LIVE', 'UPCOMING', 'PAUSED'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      episodes: {
        where: { status: 'LIVE' },
        select: { number: true, title: true },
        take: 1,
      },
    },
  });

  const [
    activeUsers,
    activePolls,
    openPredictions,
    closingPredictions,
    pendingChallenges,
    pendingWeekend,
    openReports,
    openKitchen,
    openWeekendRounds,
    pendingRedemptions,
    redemptionsToday,
    pointsSpentToday,
    trending,
    pendingEvents,
    failedEvents,
    failedDeliveries,
    actionsToday,
  ] = await Promise.all([
    prisma.userProfile.count({ where: { lastActiveAt: { gte: since } } }),
    prisma.livePoll.count({ where: { status: 'ACTIVE' } }),
    prisma.prediction.count({ where: { status: 'OPEN' } }),
    prisma.prediction.count({
      where: { status: 'OPEN', closesAt: { lte: new Date(now.getTime() + IMMINENT_MS) } },
    }),
    prisma.audienceChallenge.count({
      where: { status: { in: ['SUBMITTED', 'MODERATION'] }, deletedAt: null },
    }),
    prisma.weekendSubmission.count({
      where: { moderationStatus: { in: ['PENDING', 'ESCALATED'] }, deletedAt: null },
    }),
    prisma.abuseReport.count({ where: { status: 'PENDING' } }),
    prisma.kitchenDecision.count({ where: { status: 'OPEN' } }),
    prisma.weekendParticipationRound.count({
      where: { status: { in: ['OPEN', 'SUBMIT', 'MODERATION', 'SHORTLIST', 'PRODUCER_SELECTION'] } },
    }),
    prisma.rewardRedemption.count({ where: { status: { in: ['RESERVED', 'APPROVED'] } } }),
    prisma.rewardRedemption.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.pointsLedger.aggregate({
      where: { entryType: 'SPEND', createdAt: { gte: dayStart } },
      _sum: { delta: true },
    }),
    prisma.contestant.findMany({
      where: { deletedAt: null, status: { in: ['ACTIVE', 'NOMINATED', 'IMMUNE'] } },
      orderBy: { heatScore: 'desc' },
      take: 5,
      select: { id: true, displayName: true, heatScore: true, heatTrend: true },
    }),
    prisma.notificationEvent.count({ where: { status: 'PENDING' } }),
    prisma.notificationEvent.count({ where: { status: 'FAILED' } }),
    prisma.notificationDelivery.count({ where: { status: 'FAILED' } }),
    prisma.pointsLedger.count({ where: { createdAt: { gte: dayStart } } }),
  ]);

  const moderationTotal = pendingChallenges + pendingWeekend + openReports;

  const cards: OverviewCard[] = [
    {
      key: 'activeUsers',
      label: 'Active in the last day',
      value: activeUsers,
      detail: `${actionsToday} point-earning actions today`,
      tone: 'neutral',
    },
    {
      key: 'livePolls',
      label: 'Live polls',
      value: activePolls,
      tone: activePolls > 0 ? 'good' : 'neutral',
      href: '/admin/polls',
    },
    {
      key: 'openPredictions',
      label: 'Open predictions',
      value: openPredictions,
      detail:
        closingPredictions > 0
          ? `${closingPredictions} closing within the hour`
          : undefined,
      tone: closingPredictions > 0 ? 'warn' : 'neutral',
      href: '/admin/predictions',
    },
    {
      key: 'moderation',
      label: 'Awaiting moderation',
      value: moderationTotal,
      detail: `${pendingChallenges} challenges · ${pendingWeekend} entries · ${openReports} reports`,
      // Anything queued for a human is the one number that should nag.
      tone: moderationTotal > 0 ? 'warn' : 'good',
      href: '/admin/challenges',
    },
    {
      key: 'kitchen',
      label: 'Open kitchen decisions',
      value: openKitchen,
      tone: 'neutral',
      href: '/admin/kitchen',
    },
    {
      key: 'weekend',
      label: 'Weekend rounds in flight',
      value: openWeekendRounds,
      tone: 'neutral',
      href: '/admin/weekend',
    },
    {
      key: 'redemptions',
      label: 'Redemptions to fulfil',
      value: pendingRedemptions,
      detail: `${redemptionsToday} redeemed today`,
      tone: pendingRedemptions > 0 ? 'warn' : 'good',
      href: '/admin/rewards',
    },
    {
      key: 'notifications',
      label: 'Notification failures',
      value: failedEvents + failedDeliveries,
      detail: pendingEvents > 0 ? `${pendingEvents} events queued` : 'nothing queued',
      tone: failedEvents + failedDeliveries > 0 ? 'bad' : 'good',
      href: '/admin/notifications',
    },
  ];

  return {
    generatedAt: now.toISOString(),
    show: show
      ? {
          id: show.id,
          name: show.name,
          isLive: show.status === 'LIVE',
          episode: show.episodes[0]
            ? `Episode ${show.episodes[0].number} — ${show.episodes[0].title}`
            : null,
        }
      : null,
    cards,
    participation: { days: await participationByDay(7) },
    moderation: {
      challenges: pendingChallenges,
      weekendSubmissions: pendingWeekend,
      reports: openReports,
      redemptions: pendingRedemptions,
    },
    trendingContestants: trending.map((contestant) => ({
      id: contestant.id,
      displayName: contestant.displayName,
      heatScore: Math.round(contestant.heatScore * 10) / 10,
      heatTrend: contestant.heatTrend,
    })),
    notifications: {
      pending: pendingEvents,
      failed: failedEvents,
      deliveriesFailed: failedDeliveries,
    },
    rewards: {
      redemptionsToday,
      awaitingFulfilment: pendingRedemptions,
      // Spends are negative in the ledger; the console wants a positive figure.
      pointsSpentToday: Math.abs(pointsSpentToday._sum.delta ?? 0),
    },
    sections: sectionsForRole(role),
  };
}

/**
 * Participation for the last N days, from the points ledger.
 *
 * The ledger is used rather than a bespoke activity table because it already
 * records every action worth counting, and a second source would eventually
 * disagree with it.
 */
async function participationByDay(
  days: number,
): Promise<{ date: string; users: number; actions: number }[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const rows = await prisma.$queryRaw<{ date: Date; users: bigint; actions: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS date,
           COUNT(DISTINCT "userId") AS users,
           COUNT(*) AS actions
    FROM "PointsLedger"
    WHERE "createdAt" >= ${since} AND "entryType" = 'EARN'
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const byDate = new Map(
    rows.map((row) => [
      row.date.toISOString().slice(0, 10),
      { users: Number(row.users), actions: Number(row.actions) },
    ]),
  );

  // Fill the gaps: a day with no activity is data, not a missing bar.
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(since);
    day.setUTCDate(since.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const found = byDate.get(key);
    return { date: key, users: found?.users ?? 0, actions: found?.actions ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/** `poll.close` → `poll`. Derived so a new audited action needs no registration. */
export function moduleOf(action: string): string {
  return action.split('.')[0] ?? 'system';
}

export async function listAudit(query: AuditQueryInput): Promise<AuditFeedView> {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      // Module is a prefix of the action, so filtering by it is a prefix match.
      ...(query.module ? { action: { startsWith: `${query.module}.` } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      actor: { select: { id: true, email: true, role: true, profile: { select: { displayName: true } } } },
    },
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  const items: AuditEntryView[] = page.map((row) => ({
    id: row.id,
    action: row.action,
    module: moduleOf(row.action),
    entityType: row.entityType,
    entityId: row.entityId,
    actor: row.actor
      ? {
          id: row.actor.id,
          displayName: row.actor.profile?.displayName ?? row.actor.email,
          email: row.actor.email,
          role: row.actor.role,
        }
      : null,
    actorRole: row.actorRole,
    before: row.before,
    after: row.after,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, hasMore };
}

/**
 * The distinct values behind the filters.
 *
 * Read from the data rather than from a hardcoded list, so a filter can never
 * offer an action that was never recorded, or omit one that was.
 */
export async function auditFacets(): Promise<AuditFacetsView> {
  const [actions, entityTypes, actorRows] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    }),
    prisma.auditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
      take: 100,
    }),
    prisma.auditLog.findMany({
      distinct: ['actorId'],
      where: { actorId: { not: null } },
      select: {
        actor: { select: { id: true, email: true, role: true, profile: { select: { displayName: true } } } },
      },
      take: 100,
    }),
  ]);

  const actionNames = actions.map((row) => row.action);

  return {
    actions: actionNames,
    modules: [...new Set(actionNames.map(moduleOf))].sort(),
    entityTypes: entityTypes.map((row) => row.entityType),
    actors: actorRows
      .filter((row) => row.actor)
      .map((row) => ({
        id: row.actor!.id,
        displayName: row.actor!.profile?.displayName ?? row.actor!.email,
        role: row.actor!.role,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}
