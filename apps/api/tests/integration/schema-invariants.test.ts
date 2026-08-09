import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { disconnectTestDatabase, resetDatabase, testPrisma as db } from '../helpers/db.js';

/**
 * These tests exercise the *database*, not the application. Every invariant
 * below must hold even if a service forgets to check it, which is the whole
 * point of pushing them into constraints.
 */

const showId = 'show_test';
const contestantId = 'con_test';
let userA = '';
let userB = '';

beforeAll(async () => {
  await resetDatabase();

  const a = await db.user.create({
    data: {
      email: 'a@test.local',
      emailNormalized: 'a@test.local',
      passwordHash: 'x',
      status: 'ACTIVE',
      profile: { create: { displayName: 'UserA' } },
    },
  });
  const b = await db.user.create({
    data: {
      email: 'b@test.local',
      emailNormalized: 'b@test.local',
      passwordHash: 'x',
      status: 'ACTIVE',
      profile: { create: { displayName: 'UserB' } },
    },
  });
  userA = a.id;
  userB = b.id;

  await db.show.create({
    data: { id: showId, slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.contestant.create({
    data: { id: contestantId, showId, slug: 'test-contestant', displayName: 'Test Contestant' },
  });
});

afterAll(async () => {
  await disconnectTestDatabase();
});

describe('user uniqueness', () => {
  it('rejects a second account on the same email address', async () => {
    await expect(
      db.user.create({
        data: { email: 'a@test.local', emailNormalized: 'a@test.local', passwordHash: 'y' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate display name', async () => {
    const other = await db.user.create({
      data: { email: 'c@test.local', emailNormalized: 'c@test.local', passwordHash: 'y' },
    });
    await expect(
      db.userProfile.create({ data: { userId: other.id, displayName: 'UserA' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate verified phone number', async () => {
    await db.user.update({ where: { id: userA }, data: { phone: '+10000000001' } });
    await expect(
      db.user.update({ where: { id: userB }, data: { phone: '+10000000001' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await db.user.update({ where: { id: userA }, data: { phone: null } });
  });
});

describe('one vote per user per subject', () => {
  it('blocks a duplicate live-poll vote', async () => {
    const poll = await db.livePoll.create({
      data: {
        showId,
        question: 'Duplicate poll vote?',
        status: 'ACTIVE',
        options: { create: [{ label: 'Yes' }, { label: 'No' }] },
      },
      include: { options: true },
    });
    const optionId = poll.options[0]!.id;

    await db.pollVote.create({ data: { pollId: poll.id, userId: userA, optionId } });

    await expect(
      db.pollVote.create({ data: { pollId: poll.id, userId: userA, optionId: poll.options[1]!.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // A different user is unaffected.
    await expect(
      db.pollVote.create({ data: { pollId: poll.id, userId: userB, optionId } }),
    ).resolves.toBeTruthy();
  });

  it('blocks a second prediction entry for the same question', async () => {
    const prediction = await db.prediction.create({
      data: {
        showId,
        question: 'Duplicate prediction?',
        closesAt: new Date(Date.now() + 60_000),
        status: 'OPEN',
        options: { create: [{ label: 'A' }, { label: 'B' }] },
      },
      include: { options: true },
    });

    await db.predictionEntry.create({
      data: { predictionId: prediction.id, userId: userA, optionId: prediction.options[0]!.id },
    });

    await expect(
      db.predictionEntry.create({
        data: { predictionId: prediction.id, userId: userA, optionId: prediction.options[1]!.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks a duplicate challenge vote', async () => {
    const challenge = await db.audienceChallenge.create({
      data: {
        showId,
        authorId: userB,
        title: 'Test challenge',
        description: 'A challenge for constraint testing.',
        category: 'SOCIAL',
      },
    });

    await db.challengeVote.create({ data: { challengeId: challenge.id, userId: userA } });
    await expect(
      db.challengeVote.create({ data: { challengeId: challenge.id, userId: userA } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks a duplicate perspective vote', async () => {
    const event = await db.event.create({
      data: { showId, type: 'ARGUMENT', title: 'Test event', occurredAt: new Date() },
    });
    const perspective = await db.audiencePerspective.create({
      data: {
        showId,
        eventId: event.id,
        question: 'Who was right?',
        status: 'OPEN',
        closesAt: new Date(Date.now() + 60_000),
        options: { create: [{ label: 'One' }, { label: 'Two' }] },
      },
      include: { options: true },
    });

    await db.perspectiveVote.create({
      data: { perspectiveId: perspective.id, userId: userA, optionId: perspective.options[0]!.id },
    });
    await expect(
      db.perspectiveVote.create({
        data: { perspectiveId: perspective.id, userId: userA, optionId: perspective.options[1]!.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks voting twice for the same contestant in a nomination round', async () => {
    const round = await db.nominationRound.create({
      data: {
        showId,
        title: 'Test nominations',
        status: 'OPEN',
        opensAt: new Date(Date.now() - 1000),
        closesAt: new Date(Date.now() + 60_000),
        maxVotesPerUser: 2,
      },
    });

    await db.nominationVote.create({ data: { roundId: round.id, userId: userA, contestantId } });
    await expect(
      db.nominationVote.create({ data: { roundId: round.id, userId: userA, contestantId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks selecting the same kitchen option twice', async () => {
    const budget = await db.kitchenBudget.create({
      data: {
        showId,
        label: 'Test budget',
        totalUnits: 1000,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    const decision = await db.kitchenDecision.create({
      data: {
        showId,
        budgetId: budget.id,
        title: 'Test decision',
        question: 'What to cook?',
        status: 'OPEN',
        opensAt: new Date(Date.now() - 1000),
        closesAt: new Date(Date.now() + 60_000),
        options: { create: [{ label: 'Rice', unitCost: 100 }] },
      },
      include: { options: true },
    });

    const optionId = decision.options[0]!.id;
    await db.kitchenVote.create({ data: { decisionId: decision.id, userId: userA, optionId } });
    await expect(
      db.kitchenVote.create({ data: { decisionId: decision.id, userId: userA, optionId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks a second weekend submission of the same participation type', async () => {
    const round = await db.weekendParticipationRound.create({
      data: {
        showId,
        title: 'Test weekend',
        participationTypes: ['ASK_CONTESTANT'],
        opensAt: new Date(Date.now() - 1000),
        submissionDeadline: new Date(Date.now() + 60_000),
        closesAt: new Date(Date.now() + 120_000),
      },
    });

    await db.weekendSubmission.create({
      data: {
        roundId: round.id,
        userId: userA,
        participationType: 'ASK_CONTESTANT',
        content: 'First question',
      },
    });

    await expect(
      db.weekendSubmission.create({
        data: {
          roundId: round.id,
          userId: userA,
          participationType: 'ASK_CONTESTANT',
          content: 'Second question',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('points ledger', () => {
  it('refuses to credit the same source twice for the same reason', async () => {
    await db.pointsLedger.create({
      data: {
        userId: userA,
        delta: 50,
        balanceAfter: 50,
        sourceType: 'PREDICTION',
        sourceId: 'pred_1',
        reason: 'correct',
      },
    });

    await expect(
      db.pointsLedger.create({
        data: {
          userId: userA,
          delta: 50,
          balanceAfter: 100,
          sourceType: 'PREDICTION',
          sourceId: 'pred_1',
          reason: 'correct',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a different reason from the same source', async () => {
    await expect(
      db.pointsLedger.create({
        data: {
          userId: userA,
          delta: 5,
          balanceAfter: 55,
          sourceType: 'PREDICTION',
          sourceId: 'pred_1',
          reason: 'participation',
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('records a reversal as a new row that references the original', async () => {
    const original = await db.pointsLedger.findFirstOrThrow({
      where: { userId: userA, sourceId: 'pred_1', reason: 'correct' },
    });

    const reversal = await db.pointsLedger.create({
      data: {
        userId: userA,
        delta: -original.delta,
        balanceAfter: 5,
        entryType: 'REVERSAL',
        sourceType: 'PREDICTION',
        sourceId: 'pred_1',
        reason: `reversal:${original.id}`,
        reversedEntryId: original.id,
      },
    });

    expect(reversal.reversedEntryId).toBe(original.id);

    // The original row is untouched — that is what "immutable ledger" means.
    const stillThere = await db.pointsLedger.findUniqueOrThrow({ where: { id: original.id } });
    expect(stillThere.delta).toBe(original.delta);
    expect(stillThere.balanceAfter).toBe(original.balanceAfter);
  });

  it('reconstructs the balance by replaying deltas', async () => {
    const entries = await db.pointsLedger.findMany({
      where: { userId: userA },
      orderBy: { createdAt: 'asc' },
    });
    const replayed = entries.reduce((sum, entry) => sum + entry.delta, 0);
    expect(replayed).toBe(5); // 50 earned, 5 earned, 50 reversed
  });
});

describe('reward redemption', () => {
  it('refuses a duplicate claim of a one-per-user reward', async () => {
    const reward = await db.rewardCatalog.create({
      data: { code: 'TEST_BADGE', name: 'Test Badge', pointCost: 0, oncePerUser: true },
    });

    await db.rewardRedemption.create({
      data: { rewardId: reward.id, userId: userA, pointsSpent: 0, cycleKey: 'once' },
    });

    await expect(
      db.rewardRedemption.create({
        data: { rewardId: reward.id, userId: userA, pointsSpent: 0, cycleKey: 'once' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a repeatable reward once per cycle key', async () => {
    const reward = await db.rewardCatalog.create({
      data: { code: 'TEST_BOOST', name: 'Test Boost', pointCost: 10, oncePerUser: false },
    });

    await db.rewardRedemption.create({
      data: { rewardId: reward.id, userId: userA, pointsSpent: 10, cycleKey: '2026-W32' },
    });
    await expect(
      db.rewardRedemption.create({
        data: { rewardId: reward.id, userId: userA, pointsSpent: 10, cycleKey: '2026-W33' },
      }),
    ).resolves.toBeTruthy();
    await expect(
      db.rewardRedemption.create({
        data: { rewardId: reward.id, userId: userA, pointsSpent: 10, cycleKey: '2026-W32' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('audience result vs official outcome', () => {
  it('stores them in separate columns so they cannot be conflated', async () => {
    const round = await db.evictionRound.create({
      data: {
        showId,
        title: 'Separation test',
        status: 'CLOSED',
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() - 1000),
        audienceResult: { saved: contestantId, totalVotes: 12 },
      },
    });

    expect(round.audienceResult).toBeTruthy();
    expect(round.officialOutcome).toBeNull();
    expect(round.officialPublishedAt).toBeNull();

    const published = await db.evictionRound.update({
      where: { id: round.id },
      data: {
        officialOutcome: { evicted: contestantId, source: 'production' },
        officialPublishedAt: new Date(),
      },
    });

    expect(published.officialOutcome).toBeTruthy();
    expect(published.audienceResult).toEqual(round.audienceResult);
  });
});

describe('soft deletion', () => {
  it('keeps a soft-deleted contestant queryable but excludable', async () => {
    const contestant = await db.contestant.create({
      data: { showId, slug: 'soft-deleted', displayName: 'Gone', deletedAt: new Date() },
    });

    const visible = await db.contestant.findMany({ where: { showId, deletedAt: null } });
    expect(visible.map((c) => c.id)).not.toContain(contestant.id);

    const all = await db.contestant.findMany({ where: { showId } });
    expect(all.map((c) => c.id)).toContain(contestant.id);
  });
});
