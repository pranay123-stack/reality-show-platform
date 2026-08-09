import { prisma } from '../../core/prisma.js';
import { getLiveState, type LiveState } from '../show/show.service.js';

export interface DashboardSummary {
  live: LiveState;
  points: { balance: number; lifetime: number; earnedToday: number };
  activity: { actionsToday: number; streak: number };
  leaderboard: { rank: number | null; totalPlayers: number };
  hottestContestants: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    heatScore: number;
    heatTrend: string;
    status: string;
  }[];
  modules: {
    predictions: { open: number; nextCloseAt: string | null; awaitingYou: number };
    polls: { active: number; nextCloseAt: string | null; awaitingYou: number };
    challenges: { votingOpen: number; yoursInFlight: number };
    perspectives: { open: number; awaitingYou: number };
    nominations: { open: boolean; closesAt: string | null; votesUsed: number; voteLimit: number };
    evictions: { open: boolean; closesAt: string | null; votesUsed: number; voteLimit: number };
    kitchen: { open: number; closesAt: string | null; budgetRemaining: number | null };
    weekend: { open: boolean; deadline: string | null; submitted: boolean };
  };
}

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * One round trip for the whole dashboard.
 *
 * Eight feature widgets would otherwise be eight requests on every load; the
 * queries here are independent, so they run concurrently and the client gets a
 * single consistent snapshot.
 */
export async function getDashboard(userId: string): Promise<DashboardSummary> {
  const live = await getLiveState();
  const showId = live.show.id;
  const today = startOfToday();
  const now = new Date();

  const [
    profile,
    earnedTodayAgg,
    actionsToday,
    hottestContestants,
    openPredictions,
    myPredictionIds,
    activePolls,
    myPollIds,
    challengeVoting,
    myChallenges,
    openPerspectives,
    myPerspectiveIds,
    nominationRound,
    evictionRound,
    kitchenDecisions,
    weekendRound,
  ] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.pointsLedger.aggregate({
      where: { userId, createdAt: { gte: today }, delta: { gt: 0 } },
      _sum: { delta: true },
    }),
    prisma.pointsLedger.count({ where: { userId, createdAt: { gte: today } } }),
    prisma.contestant.findMany({
      where: { showId, deletedAt: null, status: { not: 'EVICTED' } },
      orderBy: { heatScore: 'desc' },
      take: 5,
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        heatScore: true,
        heatTrend: true,
        status: true,
      },
    }),
    prisma.prediction.findMany({
      where: { showId, status: 'OPEN', closesAt: { gt: now }, deletedAt: null },
      orderBy: { closesAt: 'asc' },
      select: { id: true, closesAt: true },
    }),
    prisma.predictionEntry.findMany({ where: { userId }, select: { predictionId: true } }),
    prisma.livePoll.findMany({
      // A poll flagged ACTIVE whose deadline has passed is not open. The
      // scheduled close job arrives in Phase 10; until then the read model
      // must not report an expired poll as live.
      where: {
        showId,
        status: 'ACTIVE',
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      },
      orderBy: { closesAt: 'asc' },
      select: { id: true, closesAt: true },
    }),
    prisma.pollVote.findMany({ where: { userId }, select: { pollId: true } }),
    prisma.audienceChallenge.count({
      where: { showId, status: 'COMMUNITY_VOTING', deletedAt: null },
    }),
    prisma.audienceChallenge.count({
      where: {
        authorId: userId,
        deletedAt: null,
        status: { in: ['SUBMITTED', 'MODERATION', 'APPROVED', 'COMMUNITY_VOTING', 'TOP_CHALLENGES', 'PRODUCER_REVIEW'] },
      },
    }),
    prisma.audiencePerspective.findMany({
      where: { showId, status: 'OPEN', closesAt: { gt: now } },
      select: { id: true },
    }),
    prisma.perspectiveVote.findMany({ where: { userId }, select: { perspectiveId: true } }),
    prisma.nominationRound.findFirst({
      where: { showId, status: 'OPEN', closesAt: { gt: now } },
      orderBy: { closesAt: 'asc' },
    }),
    prisma.evictionRound.findFirst({
      where: { showId, status: 'OPEN', closesAt: { gt: now } },
      orderBy: { closesAt: 'asc' },
    }),
    prisma.kitchenDecision.findMany({
      where: { showId, status: 'OPEN', closesAt: { gt: now } },
      orderBy: { closesAt: 'asc' },
      include: { budget: { select: { totalUnits: true, spentUnits: true } } },
    }),
    prisma.weekendParticipationRound.findFirst({
      where: { showId, status: { in: ['OPEN', 'SUBMIT'] }, submissionDeadline: { gt: now } },
      orderBy: { submissionDeadline: 'asc' },
    }),
  ]);

  const votedPredictionIds = new Set(myPredictionIds.map((entry) => entry.predictionId));
  const votedPollIds = new Set(myPollIds.map((vote) => vote.pollId));
  const votedPerspectiveIds = new Set(myPerspectiveIds.map((vote) => vote.perspectiveId));

  const [nominationVotesUsed, evictionVotesUsed, weekendSubmission, rank, totalPlayers] =
    await Promise.all([
      nominationRound
        ? prisma.nominationVote.count({ where: { roundId: nominationRound.id, userId } })
        : Promise.resolve(0),
      evictionRound
        ? prisma.evictionVote.count({ where: { roundId: evictionRound.id, userId } })
        : Promise.resolve(0),
      weekendRound
        ? prisma.weekendSubmission.findFirst({
            where: { roundId: weekendRound.id, userId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      computeRank(userId),
      prisma.userProfile.count({ where: { pointsBalance: { gt: 0 } } }),
    ]);

  const kitchenBudget = kitchenDecisions[0]?.budget;

  return {
    live,
    points: {
      balance: profile?.pointsBalance ?? 0,
      lifetime: profile?.lifetimePoints ?? 0,
      earnedToday: earnedTodayAgg._sum.delta ?? 0,
    },
    activity: { actionsToday, streak: profile?.currentStreak ?? 0 },
    leaderboard: { rank, totalPlayers },
    hottestContestants,
    modules: {
      predictions: {
        open: openPredictions.length,
        nextCloseAt: openPredictions[0]?.closesAt.toISOString() ?? null,
        awaitingYou: openPredictions.filter((p) => !votedPredictionIds.has(p.id)).length,
      },
      polls: {
        active: activePolls.length,
        nextCloseAt: activePolls[0]?.closesAt?.toISOString() ?? null,
        awaitingYou: activePolls.filter((p) => !votedPollIds.has(p.id)).length,
      },
      challenges: { votingOpen: challengeVoting, yoursInFlight: myChallenges },
      perspectives: {
        open: openPerspectives.length,
        awaitingYou: openPerspectives.filter((p) => !votedPerspectiveIds.has(p.id)).length,
      },
      nominations: {
        open: Boolean(nominationRound),
        closesAt: nominationRound?.closesAt.toISOString() ?? null,
        votesUsed: nominationVotesUsed,
        voteLimit: nominationRound?.maxVotesPerUser ?? 0,
      },
      evictions: {
        open: Boolean(evictionRound),
        closesAt: evictionRound?.closesAt.toISOString() ?? null,
        votesUsed: evictionVotesUsed,
        voteLimit: evictionRound?.maxVotesPerUser ?? 0,
      },
      kitchen: {
        open: kitchenDecisions.length,
        closesAt: kitchenDecisions[0]?.closesAt.toISOString() ?? null,
        budgetRemaining: kitchenBudget ? kitchenBudget.totalUnits - kitchenBudget.spentUnits : null,
      },
      weekend: {
        open: Boolean(weekendRound),
        deadline: weekendRound?.submissionDeadline.toISOString() ?? null,
        submitted: Boolean(weekendSubmission),
      },
    },
  };
}

/**
 * Provisional rank straight from the balance column. Phase 15 replaces this
 * with the Redis-backed leaderboard; until then it is honest but unindexed for
 * scale, so it is only ever computed for one user at a time.
 */
async function computeRank(userId: string): Promise<number | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { pointsBalance: true },
  });
  if (!profile) return null;

  const ahead = await prisma.userProfile.count({
    where: { pointsBalance: { gt: profile.pointsBalance } },
  });
  return ahead + 1;
}
