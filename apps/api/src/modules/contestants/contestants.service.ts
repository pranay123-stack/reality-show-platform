import type {
  ContestantStatus,
  CreateContestantInput,
  HeatWindow,
} from '@reality/shared';
import { ERROR_CODES } from '@reality/shared';

import { AppError, conflict, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { getCurrentShowId } from '../show/show.service.js';

export interface ContestantSummary {
  id: string;
  slug: string;
  displayName: string;
  tagline: string | null;
  avatarUrl: string | null;
  occupation: string | null;
  hometown: string | null;
  age: number | null;
  status: string;
  heatScore: number;
  heatTrend: string;
  heatUpdatedAt: string | null;
}

export async function listContestants(options: {
  status?: string;
  sort?: 'heat' | 'name';
} = {}): Promise<ContestantSummary[]> {
  const showId = await getCurrentShowId();

  const contestants = await prisma.contestant.findMany({
    where: {
      showId,
      deletedAt: null,
      ...(options.status ? { status: options.status as never } : {}),
    },
    orderBy:
      options.sort === 'name' ? { displayName: 'asc' } : [{ heatScore: 'desc' }, { displayName: 'asc' }],
  });

  return contestants.map(toSummary);
}

function toSummary(contestant: {
  id: string;
  slug: string;
  displayName: string;
  tagline: string | null;
  avatarUrl: string | null;
  occupation: string | null;
  hometown: string | null;
  age: number | null;
  status: string;
  heatScore: number;
  heatTrend: string;
  heatUpdatedAt: Date | null;
}): ContestantSummary {
  return {
    id: contestant.id,
    slug: contestant.slug,
    displayName: contestant.displayName,
    tagline: contestant.tagline,
    avatarUrl: contestant.avatarUrl,
    occupation: contestant.occupation,
    hometown: contestant.hometown,
    age: contestant.age,
    status: contestant.status,
    heatScore: contestant.heatScore,
    heatTrend: contestant.heatTrend,
    heatUpdatedAt: contestant.heatUpdatedAt?.toISOString() ?? null,
  };
}

/**
 * Full contestant page payload: profile, current heat, recent activity, the
 * polls and perspectives that mention them, and audience support.
 */
export async function getContestant(idOrSlug: string) {
  const showId = await getCurrentShowId();

  const contestant = await prisma.contestant.findFirst({
    where: {
      showId,
      deletedAt: null,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  });

  if (!contestant) throw notFound('That contestant does not exist');

  const since = new Date(Date.now() - 7 * 24 * 3600_000);

  const [events, pollOptions, perspectiveOptions, supportVotes, totalSupportVotes, rank] =
    await Promise.all([
      prisma.eventContestant.findMany({
        where: { contestantId: contestant.id },
        include: { event: true },
        orderBy: { event: { occurredAt: 'desc' } },
        take: 8,
      }),
      prisma.pollOption.findMany({
        where: { contestantId: contestant.id, poll: { status: { in: ['ACTIVE', 'PUBLISHED'] } } },
        include: { poll: { select: { id: true, question: true, status: true, totalVotes: true } } },
        take: 5,
      }),
      prisma.perspectiveOption.findMany({
        where: { contestantId: contestant.id },
        include: {
          perspective: {
            select: { id: true, question: true, status: true, totalVotes: true, eventId: true },
          },
        },
        orderBy: { voteCount: 'desc' },
        take: 5,
      }),
      prisma.pollVote.count({
        where: { option: { contestantId: contestant.id }, createdAt: { gte: since } },
      }),
      prisma.pollVote.count({ where: { createdAt: { gte: since } } }),
      rankOf(contestant.id, showId),
    ]);

  return {
    ...toSummary(contestant),
    bio: contestant.bio,
    enteredAt: contestant.enteredAt?.toISOString() ?? null,
    exitedAt: contestant.exitedAt?.toISOString() ?? null,
    rank,
    audienceSupport: {
      votesLast7Days: supportVotes,
      shareOfAllVotes:
        totalSupportVotes > 0 ? Math.round((supportVotes / totalSupportVotes) * 1000) / 10 : 0,
    },
    recentEvents: events.map((link) => ({
      id: link.event.id,
      type: link.event.type,
      title: link.event.title,
      description: link.event.description,
      occurredAt: link.event.occurredAt.toISOString(),
    })),
    relatedPolls: pollOptions.map((option) => ({
      id: option.poll.id,
      question: option.poll.question,
      status: option.poll.status,
      votesForContestant: option.voteCount,
      totalVotes: option.poll.totalVotes,
    })),
    relatedPerspectives: perspectiveOptions.map((option) => ({
      id: option.perspective.id,
      question: option.perspective.question,
      status: option.perspective.status,
      optionLabel: option.label,
      votesForOption: option.voteCount,
      totalVotes: option.perspective.totalVotes,
    })),
  };
}

async function rankOf(contestantId: string, showId: string): Promise<number> {
  const contestant = await prisma.contestant.findUniqueOrThrow({
    where: { id: contestantId },
    select: { heatScore: true },
  });
  const ahead = await prisma.contestant.count({
    where: { showId, deletedAt: null, heatScore: { gt: contestant.heatScore } },
  });
  return ahead + 1;
}

const WINDOW_CONFIG: Record<HeatWindow, { since: () => Date; buckets: number }> = {
  '24h': { since: () => new Date(Date.now() - 24 * 3600_000), buckets: 24 },
  '7d': { since: () => new Date(Date.now() - 7 * 24 * 3600_000), buckets: 28 },
  season: { since: () => new Date(Date.now() - 120 * 24 * 3600_000), buckets: 40 },
};

/**
 * Heat history for a chart.
 *
 * Snapshots are downsampled into a fixed number of buckets server-side, so the
 * client receives ~30 points whether the window holds 24 rows or 4,000, and the
 * chart cannot be made slow by a long season.
 */
export async function getHeatHistory(contestantId: string, window: HeatWindow = '24h') {
  const config = WINDOW_CONFIG[window];
  const since = config.since();

  const snapshots = await prisma.contestantHeatSnapshot.findMany({
    where: { contestantId, computedAt: { gte: since } },
    orderBy: { computedAt: 'asc' },
    select: { heatScore: true, trend: true, computedAt: true },
  });

  if (snapshots.length === 0) return { window, points: [], min: null, max: null, change: 0 };

  const first = snapshots[0]!.computedAt.getTime();
  const last = snapshots.at(-1)!.computedAt.getTime();
  const span = Math.max(1, last - first);
  const bucketMs = span / config.buckets;

  const buckets = new Map<number, { sum: number; count: number; at: number }>();
  for (const snapshot of snapshots) {
    const index = Math.min(
      config.buckets - 1,
      Math.floor((snapshot.computedAt.getTime() - first) / bucketMs),
    );
    const bucket = buckets.get(index) ?? { sum: 0, count: 0, at: first + index * bucketMs };
    bucket.sum += snapshot.heatScore;
    bucket.count += 1;
    buckets.set(index, bucket);
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, bucket]) => ({
      at: new Date(bucket.at).toISOString(),
      score: Math.round((bucket.sum / bucket.count) * 100) / 100,
    }));

  const scores = points.map((point) => point.score);

  return {
    window,
    points,
    min: Math.min(...scores),
    max: Math.max(...scores),
    change: Math.round((scores.at(-1)! - scores[0]!) * 100) / 100,
  };
}

/**
 * Records a profile view. Fire-and-forget from the client's point of view: it
 * feeds the heat formula and must never slow a page render or fail a request.
 */
export async function recordProfileView(contestantId: string): Promise<void> {
  await prisma.contestantMetric.upsert({
    where: { contestantId_metricKey: { contestantId, metricKey: 'profileViews' } },
    update: { value: { increment: 1 } },
    create: { contestantId, metricKey: 'profileViews', value: 1 },
  });
}


// ---------------------------------------------------------------------------
// Operator management
// ---------------------------------------------------------------------------

/**
 * Creating a contestant.
 *
 * `heatScore` is deliberately not settable. Heat is computed from real audience
 * signals by `ContestantHeatService`; letting an operator type a number in
 * would make the meter an opinion rather than a measurement.
 */
export async function createContestant(input: CreateContestantInput) {
  const showId = await getCurrentShowId();

  const existing = await prisma.contestant.findFirst({
    where: { showId, slug: input.slug },
    select: { id: true },
  });
  if (existing) throw conflict(ERROR_CODES.CONFLICT, 'That slug is already taken on this show');

  return prisma.contestant.create({
    data: {
      showId,
      slug: input.slug,
      displayName: input.displayName,
      tagline: input.tagline ?? null,
      bio: input.bio ?? null,
      avatarUrl: input.avatarUrl ?? null,
      age: input.age ?? null,
      occupation: input.occupation ?? null,
      hometown: input.hometown ?? null,
      enteredAt: new Date(),
    },
  });
}

export async function updateContestant(
  contestantId: string,
  input: Partial<Omit<CreateContestantInput, 'slug'>>,
) {
  const contestant = await prisma.contestant.findFirst({
    where: { id: contestantId, deletedAt: null },
    select: { id: true },
  });
  if (!contestant) throw notFound('That contestant does not exist');

  return prisma.contestant.update({
    where: { id: contestantId },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.age !== undefined ? { age: input.age } : {}),
      ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
      ...(input.hometown !== undefined ? { hometown: input.hometown } : {}),
    },
  });
}

/**
 * Status changes.
 *
 * EVICTED and WINNER are outcomes of the show, so they stamp `exitedAt` and a
 * return to ACTIVE clears it. Nothing here deletes a contestant: their votes,
 * heat history and prediction options all reference them, and removing the row
 * would silently rewrite past results.
 */
export async function setContestantStatus(contestantId: string, status: ContestantStatus) {
  const contestant = await prisma.contestant.findFirst({
    where: { id: contestantId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!contestant) throw notFound('That contestant does not exist');

  if (contestant.status === status) {
    throw new AppError({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      message: `That contestant is already ${status.toLowerCase()}`,
      statusCode: 409,
    });
  }

  const leaving = status === 'EVICTED' || status === 'WINNER';

  return prisma.contestant.update({
    where: { id: contestantId },
    data: {
      status,
      ...(leaving ? { exitedAt: new Date() } : { exitedAt: null }),
    },
  });
}

/**
 * The operator list.
 *
 * Unlike the public list this includes every status and carries the engagement
 * counts an operator needs to judge whether a contestant is actually landing
 * with the audience.
 */
export async function listContestantsForAdmin() {
  const showId = await getCurrentShowId();

  const contestants = await prisma.contestant.findMany({
    where: { showId, deletedAt: null },
    orderBy: [{ status: 'asc' }, { heatScore: 'desc' }],
    include: {
      _count: {
        select: {
          predictionOptions: true,
          perspectiveOptions: true,
          events: true,
          heatSnapshots: true,
        },
      },
    },
  });

  return contestants.map((contestant) => ({
    id: contestant.id,
    slug: contestant.slug,
    displayName: contestant.displayName,
    tagline: contestant.tagline,
    avatarUrl: contestant.avatarUrl,
    occupation: contestant.occupation,
    hometown: contestant.hometown,
    age: contestant.age,
    status: contestant.status,
    heatScore: contestant.heatScore,
    heatTrend: contestant.heatTrend,
    heatUpdatedAt: contestant.heatUpdatedAt?.toISOString() ?? null,
    enteredAt: contestant.enteredAt?.toISOString() ?? null,
    exitedAt: contestant.exitedAt?.toISOString() ?? null,
    engagement: {
      predictionOptions: contestant._count.predictionOptions,
      perspectiveOptions: contestant._count.perspectiveOptions,
      events: contestant._count.events,
      heatSnapshots: contestant._count.heatSnapshots,
    },
  }));
}
