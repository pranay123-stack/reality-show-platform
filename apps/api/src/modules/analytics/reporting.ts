import {
  ANALYTICS_EVENTS,
  METRIC_LABELS,
  type AnalyticsMetric,
  type AnalyticsOverviewView,
  type ContestantTrend,
  type FeatureUsage,
  type FunnelStep,
  type MetricSummary,
  type TrendPoint,
} from '@reality/shared';

import { prisma } from '../../core/prisma.js';
import { formatFor, startOfDayUtc } from './aggregation.js';

/**
 * Everything the dashboard reads.
 *
 * Only `AnalyticsAggregate` and `AnalyticsSnapshot` are touched here. No
 * function in this file reads `AnalyticsEvent`, and none reads a transactional
 * table except for contestant *names*, which are a bounded lookup for the page
 * being rendered rather than an aggregate over live data.
 */

function daysAgo(days: number): Date {
  const day = startOfDayUtc(new Date());
  day.setUTCDate(day.getUTCDate() - (days - 1));
  return day;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Fills the gaps: a day with no activity is data, not a missing point. */
function densify(
  rows: { date: Date; value: number; uniqueUsers: number }[],
  days: number,
): TrendPoint[] {
  const byDate = new Map(rows.map((row) => [isoDay(row.date), row]));
  const start = daysAgo(days);

  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const key = isoDay(day);
    const found = byDate.get(key);
    return { date: key, value: found?.value ?? 0, uniqueUsers: found?.uniqueUsers ?? 0 };
  });
}

/** Percentage change of the latest half of a window against the earlier half. */
function changePercent(series: TrendPoint[]): number | null {
  if (series.length < 4) return null;

  const midpoint = Math.floor(series.length / 2);
  const earlier = series.slice(0, midpoint).reduce((sum, point) => sum + point.value, 0);
  const later = series.slice(midpoint).reduce((sum, point) => sum + point.value, 0);

  // No baseline means no meaningful percentage — "up infinity%" says nothing.
  if (earlier === 0) return later === 0 ? 0 : null;
  return Math.round(((later - earlier) / earlier) * 1000) / 10;
}

const HEADLINE_METRICS: AnalyticsMetric[] = [
  'dau',
  'new_users',
  'sessions',
  'prediction_participation',
  'poll_participation',
  'reward_redemptions',
];

/**
 * The engagement funnel.
 *
 * Ordered by depth of commitment rather than by chronology: looking is easier
 * than voting, voting is easier than creating, creating is easier than spending
 * what you earned. Each step counts *distinct users*, so somebody who voted
 * fifty times is one person at that step.
 */
const FUNNEL: { key: string; label: string; metrics: string[] }[] = [
  { key: 'active', label: 'Active', metrics: ['dau'] },
  {
    key: 'viewed',
    label: 'Looked at something',
    metrics: ['event:poll_viewed', 'event:prediction_viewed', 'event:contestant_viewed'],
  },
  {
    key: 'voted',
    label: 'Took part',
    metrics: ['event:poll_voted', 'event:prediction_submitted', 'event:kitchen_voted', 'event:perspective_voted'],
  },
  {
    key: 'created',
    label: 'Contributed',
    metrics: ['event:challenge_created', 'event:weekend_submitted'],
  },
  { key: 'redeemed', label: 'Spent points', metrics: ['event:reward_redeemed'] },
];

const FEATURES: { feature: string; label: string; metric: string }[] = [
  { feature: 'prediction', label: 'Prediction game', metric: 'prediction_participation' },
  { feature: 'poll', label: 'Live polls', metric: 'poll_participation' },
  { feature: 'challenge', label: 'Challenges', metric: 'challenge_participation' },
  { feature: 'perspective', label: 'Perspectives', metric: 'perspective_participation' },
  { feature: 'kitchen', label: 'Kitchen', metric: 'kitchen_participation' },
  { feature: 'weekend', label: 'Weekend', metric: 'weekend_participation' },
  { feature: 'reward', label: 'Rewards', metric: 'reward_redemptions' },
];

export async function getOverview(days: number): Promise<AnalyticsOverviewView> {
  const since = daysAgo(days);

  const [latestSnapshot, aggregates, optedOut, totalUsers] = await Promise.all([
    prisma.analyticsSnapshot.findFirst({ orderBy: { date: 'desc' } }),
    prisma.analyticsAggregate.findMany({
      where: { date: { gte: since } },
      select: { date: true, metric: true, dimension: true, value: true, uniqueUsers: true },
      orderBy: { date: 'asc' },
    }),
    prisma.userProfile.count({ where: { analyticsOptOut: true } }),
    prisma.userProfile.count(),
  ]);

  /** Index the one query above rather than issuing a query per metric. */
  const byMetric = new Map<string, { date: Date; value: number; uniqueUsers: number }[]>();
  for (const row of aggregates) {
    if (row.dimension !== '') continue;
    const list = byMetric.get(row.metric) ?? [];
    list.push({ date: row.date, value: row.value, uniqueUsers: row.uniqueUsers });
    byMetric.set(row.metric, list);
  }

  const summary: MetricSummary[] = HEADLINE_METRICS.map((metric) => {
    const series = densify(byMetric.get(metric) ?? [], days);
    return {
      metric,
      label: METRIC_LABELS[metric],
      value: series.at(-1)?.value ?? 0,
      changePercent: changePercent(series),
      format: formatFor(metric),
      series,
    };
  });

  // Rolling windows come from the snapshot, because they cannot be summed.
  if (latestSnapshot) {
    summary.splice(1, 0, {
      metric: 'mau',
      label: METRIC_LABELS.mau,
      value: latestSnapshot.mau,
      changePercent: null,
      format: 'count',
      series: [],
    });
  }

  const uniqueUsersFor = (metrics: string[]): number => {
    // Distinct users cannot be added across metrics without double-counting, so
    // the widest single contributing metric is used as the honest floor.
    let best = 0;
    for (const metric of metrics) {
      const rows = byMetric.get(metric) ?? [];
      best = Math.max(best, ...rows.map((row) => row.uniqueUsers), 0);
    }
    return best;
  };

  const funnelRaw = FUNNEL.map((step) => ({ ...step, users: uniqueUsersFor(step.metrics) }));
  const start = funnelRaw[0]?.users ?? 0;

  const engagementFunnel: FunnelStep[] = funnelRaw.map((step, index) => {
    const previous = index === 0 ? step.users : funnelRaw[index - 1]!.users;
    return {
      key: step.key,
      label: step.label,
      users: step.users,
      ofStart: start > 0 ? Math.round((step.users / start) * 1000) / 10 : 0,
      ofPrevious: previous > 0 ? Math.round((step.users / previous) * 1000) / 10 : 0,
    };
  });

  const activeUsers = latestSnapshot?.mau ?? start;

  const featureUsage: FeatureUsage[] = FEATURES.map((feature) => {
    const rows = byMetric.get(feature.metric) ?? [];
    const events = rows.reduce((sum, row) => sum + row.value, 0);
    const users = Math.max(0, ...rows.map((row) => row.uniqueUsers), 0);
    return {
      feature: feature.feature,
      label: feature.label,
      users,
      events,
      adoption: activeUsers > 0 ? Math.round((users / activeUsers) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.users - a.users);

  return {
    generatedAt: new Date().toISOString(),
    asOf: latestSnapshot ? isoDay(latestSnapshot.date) : null,
    rangeDays: days,
    // A snapshot older than yesterday means the scheduled pass is not running.
    stale: !latestSnapshot || latestSnapshot.date < daysAgo(2),
    summary,
    engagementFunnel,
    featureUsage,
    contestantTrends: await contestantTrends(aggregates),
    economy: {
      pointsEarned: densify(byMetric.get('points_earned') ?? [], days),
      pointsSpent: densify(byMetric.get('points_spent') ?? [], days),
      redemptions: densify(byMetric.get('reward_redemptions') ?? [], days),
    },
    participation: densify(byMetric.get('dau') ?? [], days),
    privacy: {
      optedOut,
      totalUsers,
      coveragePercent:
        totalUsers > 0 ? Math.round(((totalUsers - optedOut) / totalUsers) * 1000) / 10 : 100,
    },
  };
}

async function contestantTrends(
  aggregates: { metric: string; dimension: string; value: number; uniqueUsers: number }[],
): Promise<ContestantTrend[]> {
  const totals = new Map<string, { views: number; users: number }>();

  for (const row of aggregates) {
    if (row.metric !== 'contestant_views' || !row.dimension) continue;
    const found = totals.get(row.dimension) ?? { views: 0, users: 0 };
    found.views += row.value;
    found.users = Math.max(found.users, row.uniqueUsers);
    totals.set(row.dimension, found);
  }

  const top = [...totals.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 8);
  if (top.length === 0) return [];

  // A bounded lookup for the rows being rendered, not an aggregate over a
  // transactional table.
  const contestants = await prisma.contestant.findMany({
    where: { id: { in: top.map(([id]) => id) } },
    select: { id: true, displayName: true, heatScore: true, heatTrend: true },
  });
  const byId = new Map(contestants.map((contestant) => [contestant.id, contestant]));

  return top
    .filter(([id]) => byId.has(id))
    .map(([id, counts]) => ({
      contestantId: id,
      displayName: byId.get(id)!.displayName,
      views: counts.views,
      heatViews: counts.users,
      heatScore: Math.round(byId.get(id)!.heatScore * 10) / 10,
      heatTrend: byId.get(id)!.heatTrend,
    }));
}

/** The per-event breakdown behind the categories, for the events table. */
export async function getEventBreakdown(days: number) {
  const rows = await prisma.analyticsAggregate.findMany({
    where: { date: { gte: daysAgo(days) }, dimension: '', metric: { startsWith: 'event:' } },
    select: { metric: true, value: true, uniqueUsers: true },
  });

  const totals = new Map<string, { events: number; users: number }>();
  for (const row of rows) {
    const name = row.metric.slice('event:'.length);
    const found = totals.get(name) ?? { events: 0, users: 0 };
    found.events += row.value;
    found.users = Math.max(found.users, row.uniqueUsers);
    totals.set(name, found);
  }

  return [...totals.entries()]
    .map(([name, counts]) => ({
      name,
      label: ANALYTICS_EVENTS[name as keyof typeof ANALYTICS_EVENTS]?.label ?? name,
      category: ANALYTICS_EVENTS[name as keyof typeof ANALYTICS_EVENTS]?.category ?? 'other',
      events: counts.events,
      users: counts.users,
    }))
    .sort((a, b) => b.events - a.events);
}
