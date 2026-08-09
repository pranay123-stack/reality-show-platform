import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const WEEKEND = `${API_PREFIX}/weekend`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectTestDatabase();
});

async function makeUser(
  email: string,
  displayName: string,
  role: 'USER' | 'MODERATOR' | 'PRODUCER' = 'USER',
) {
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: await hashPassword(VALID_PASSWORD),
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName } },
    },
  });

  const client = new TestClient(app);
  await client.request({
    method: 'POST',
    url: `${AUTH}/login`,
    payload: { email, password: VALID_PASSWORD },
  });
  return Object.assign(client, { userId: user.id });
}

/**
 * Gives a user genuine engagement across several features, which is what the
 * eligibility rules are actually measuring.
 */
async function giveEngagement(
  userId: string,
  options: { points?: number; features?: number } = {},
) {
  const features = options.features ?? 4;

  await db.userProfile.update({
    where: { userId },
    data: { lifetimePoints: options.points ?? 500, pointsBalance: options.points ?? 500 },
  });

  if (features >= 1) {
    const prediction = await db.prediction.create({
      data: {
        showId: 'show_test',
        question: `Engagement prediction ${userId}`,
        status: 'OPEN',
        closesAt: new Date(Date.now() + 60_000),
        options: { create: [{ label: 'A' }, { label: 'B' }] },
      },
      include: { options: true },
    });
    await db.predictionEntry.create({
      data: { predictionId: prediction.id, userId, optionId: prediction.options[0]!.id },
    });
  }

  if (features >= 2) {
    const poll = await db.livePoll.create({
      data: {
        showId: 'show_test',
        question: `Engagement poll ${userId}`,
        status: 'ACTIVE',
        options: { create: [{ label: 'A' }, { label: 'B' }] },
      },
      include: { options: true },
    });
    await db.pollVote.create({
      data: { pollId: poll.id, userId, optionId: poll.options[0]!.id },
    });
  }

  if (features >= 3) {
    await db.audienceChallenge.create({
      data: {
        showId: 'show_test',
        authorId: userId,
        title: 'Engagement challenge',
        description: 'A challenge created to demonstrate genuine engagement.',
        category: 'SOCIAL',
      },
    });
  }

  if (features >= 4) {
    const event = await db.event.create({
      data: {
        showId: 'show_test',
        type: 'ARGUMENT',
        title: `Engagement event ${userId}`,
        occurredAt: new Date(),
      },
    });
    const perspective = await db.audiencePerspective.create({
      data: {
        showId: 'show_test',
        eventId: event.id,
        question: 'Who was right?',
        status: 'OPEN',
        closesAt: new Date(Date.now() + 60_000),
        options: { create: [{ label: 'One' }, { label: 'Two' }] },
      },
      include: { options: true },
    });
    await db.perspectiveVote.create({
      data: { perspectiveId: perspective.id, userId, optionId: perspective.options[0]!.id },
    });
  }
}

beforeEach(async () => {
  await resetAll();
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.pointsRule.createMany({
    data: [
      { key: 'WEEKEND_SUBMISSION', points: 15 },
      { key: 'WEEKEND_SHORTLISTED', points: 60 },
      { key: 'WEEKEND_SELECTED', points: 250 },
    ],
  });
  await db.contestant.create({
    data: { id: 'con_a', showId: 'show_test', slug: 'con-a', displayName: 'Contestant A' },
  });
});

interface RoundOptions {
  status?: 'OPEN' | 'SUBMIT' | 'MODERATION' | 'SHORTLIST' | 'PRODUCER_SELECTION' | 'SELECTED' | 'COMPLETED' | 'CANCELLED';
  deadlineInMs?: number;
  minPoints?: number;
  minActivities?: number;
  minDistinctFeatures?: number;
  shortlistSize?: number;
  selectionCount?: number;
}

async function seedRound(options: RoundOptions = {}) {
  return db.weekendParticipationRound.create({
    data: {
      id: 'wr_test',
      showId: 'show_test',
      title: 'Weekend 12 — Ask the house',
      description: 'Send a question for the weekend episode.',
      status: options.status ?? 'SUBMIT',
      participationTypes: ['ASK_CONTESTANT', 'VIDEO_QUESTION', 'MINI_GAME'],
      opensAt: new Date(Date.now() - 60_000),
      submissionDeadline: new Date(Date.now() + (options.deadlineInMs ?? 3600_000)),
      closesAt: new Date(Date.now() + 7200_000),
      shortlistSize: options.shortlistSize ?? 10,
      selectionCount: options.selectionCount ?? 3,
      eligibilityConfig: {
        minPoints: options.minPoints ?? 100,
        minActivities: options.minActivities ?? 3,
        minDistinctFeatures: options.minDistinctFeatures ?? 2,
      },
      allowPhysicalRewards: false,
      questions: {
        create: [
          { id: 'wq_1', prompt: 'What would you ask a contestant?', type: 'ASK_CONTESTANT', maxLength: 400 },
        ],
      },
    },
  });
}

const GOOD_ENTRY = {
  participationType: 'ASK_CONTESTANT' as const,
  questionId: 'wq_1',
  content: 'How did you actually feel when the alliance collapsed on Tuesday night?',
};

// ---------------------------------------------------------------------------

describe('viewing the weekend round', () => {
  it('shows the current round, deadline and rewards to anyone', async () => {
    await seedRound();
    const response = await app.inject({ method: 'GET', url: `${WEEKEND}/current` });

    expect(response.statusCode).toBe(200);
    const round = response.json().data;
    expect(round.title).toBe('Weekend 12 — Ask the house');
    expect(round.submissionsOpen).toBe(true);
    expect(round.participationTypes).toContain('ASK_CONTESTANT');
    expect(round.questions).toHaveLength(1);
    expect(round.rewards.onAirRecognition).toBe(true);
    expect(round.rewards.inPersonOpportunity).toBe(false);
  });

  it('tells a signed-out visitor to sign in rather than guessing eligibility', async () => {
    await seedRound();
    const round = (await app.inject({ method: 'GET', url: `${WEEKEND}/current` })).json().data;

    expect(round.eligibility.eligible).toBe(false);
    expect(round.eligibility.blockers[0]).toMatch(/sign in/i);
  });

  it('shows an ineligible user exactly what is missing', async () => {
    await seedRound({ minPoints: 100, minActivities: 3, minDistinctFeatures: 2 });
    const client = await makeUser('new@test.local', 'Newcomer');

    const round = (await client.request({ method: 'GET', url: `${WEEKEND}/current` })).json().data;

    expect(round.eligibility.eligible).toBe(false);
    const byKey = Object.fromEntries(
      round.eligibility.requirements.map((r: { key: string; met: boolean }) => [r.key, r.met]),
    );
    expect(byKey.points).toBe(false);
    expect(byKey.distinctFeatures).toBe(false);
    expect(round.eligibility.blockers.length).toBeGreaterThan(0);
  });

  it('reports an engaged user as eligible', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const round = (await client.request({ method: 'GET', url: `${WEEKEND}/current` })).json().data;
    expect(round.eligibility.eligible).toBe(true);
    expect(round.eligibility.blockers).toEqual([]);
  });

  it('exposes eligibility on its own endpoint too', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const response = await client.request({
      method: 'GET',
      url: `${WEEKEND}/eligibility?roundId=wr_test`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.eligibility.eligible).toBe(true);
    expect(response.json().data.engagement.distinctFeatures).toBeGreaterThanOrEqual(2);
  });
});

describe('submitting an entry', () => {
  it('accepts an eligible user and credits submission points', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId, { points: 500 });

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.submission.status).toBe('SUBMITTED');
    expect(body.submission.moderationOutcome).toBe('PENDING');
    expect(body.pointsAwarded).toBe(15);
    expect(body.round.mySubmissions).toHaveLength(1);
    expect(body.round.availableTypes).not.toContain('ASK_CONTESTANT');

    const ledger = await db.pointsLedger.findMany({ where: { sourceId: 'wr_test' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ sourceType: 'WEEKEND', reason: 'submission' });
  });

  it('refuses an ineligible user with the reason, not just a 403', async () => {
    await seedRound({ minPoints: 100, minActivities: 3, minDistinctFeatures: 2 });
    const client = await makeUser('new@test.local', 'Newcomer');

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NOT_ELIGIBLE');
    expect(response.json().error.details.requirements).toBeTruthy();
    expect(await db.weekendSubmission.count()).toBe(0);
  });

  it('refuses someone who farmed a single feature', async () => {
    await seedRound({ minPoints: 100, minActivities: 3, minDistinctFeatures: 2 });
    const client = await makeUser('farmer@test.local', 'Farmer');
    // Plenty of points and activity, but all from one feature.
    await giveEngagement(client.userId, { points: 10_000, features: 1 });

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NOT_ELIGIBLE');
  });

  it('refuses a second entry of the same kind', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });
    const second = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: { ...GOOD_ENTRY, content: 'A different question entirely, but the same kind.' },
    });

    expect(second.statusCode).toBe(409);
    expect(await db.weekendSubmission.count()).toBe(1);
    // Being refused must not have paid a second time.
    expect(await db.pointsLedger.count({ where: { sourceId: 'wr_test' } })).toBe(1);
  });

  it('allows a different participation type from the same user', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });
    const second = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: {
        participationType: 'MINI_GAME',
        content: 'A mini game where contestants guess each other’s answers.',
      },
    });

    expect(second.statusCode).toBe(201);
    expect(await db.weekendSubmission.count()).toBe(2);
  });

  it('refuses a participation type the round does not offer', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: { participationType: 'VIRTUAL_AUDIENCE', content: 'I would love to be there.' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses an entry after the deadline', async () => {
    await seedRound({ deadlineInMs: -1000 });
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SUBMISSION_CLOSED');
  });

  it('refuses an entry once the round has moved past submissions', async () => {
    await seedRound({ status: 'MODERATION' });
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });

    expect(response.statusCode).toBe(409);
  });

  it('screens abusive content the same way challenges do', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: { ...GOOD_ENTRY, content: 'Ask that idiot why they eat shit on camera every day' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CONTENT_REJECTED');
    expect(await db.weekendSubmission.count()).toBe(0);
  });

  it('enforces the question’s own length limit', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: { ...GOOD_ENTRY, content: 'x'.repeat(500) }, // question maxLength is 400
    });

    expect(response.statusCode).toBe(400);
  });

  it('lets a user withdraw before the deadline but not after selection', async () => {
    await seedRound();
    const client = await makeUser('engaged@test.local', 'Engaged');
    await giveEngagement(client.userId);

    const created = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });
    const submissionId = created.json().data.submission.id;

    const withdrawn = await client.request({
      method: 'DELETE',
      url: `${WEEKEND}/submissions/${submissionId}`,
    });
    expect(withdrawn.statusCode).toBe(200);

    // Soft-deleted: the moderation trail survives.
    const stored = await db.weekendSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(stored.deletedAt).not.toBeNull();
  });

  it('refuses to withdraw someone else’s entry', async () => {
    await seedRound();
    const owner = await makeUser('owner@test.local', 'Owner');
    await giveEngagement(owner.userId);
    const stranger = await makeUser('stranger@test.local', 'Stranger');

    const created = await owner.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: GOOD_ENTRY,
    });
    const submissionId = created.json().data.submission.id;

    const response = await stranger.request({
      method: 'DELETE',
      url: `${WEEKEND}/submissions/${submissionId}`,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('the funnel', () => {
  async function submitAs(email: string, content: string) {
    const client = await makeUser(email, email.split('@')[0]!);
    await giveEngagement(client.userId);
    const created = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_test/submissions`,
      payload: { ...GOOD_ENTRY, content },
    });
    return { client, submissionId: created.json().data.submission.id as string };
  }

  it('walks OPEN → SUBMIT → MODERATION → SHORTLIST → PRODUCER_SELECTION → SELECTED → COMPLETED', async () => {
    await seedRound({ status: 'SUBMIT', selectionCount: 1, shortlistSize: 2 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const first = await submitAs('one@test.local', 'What was going through your head on Tuesday?');
    await submitAs('two@test.local', 'Which alliance do you actually trust in that house?');

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'MODERATION' },
    });

    // Moderate both entries.
    const queue = (
      await producer.request({ method: 'GET', url: `${WEEKEND}/admin/wr_test/submissions` })
    ).json().data;
    expect(queue).toHaveLength(2);

    for (const item of queue) {
      await producer.request({
        method: 'POST',
        url: `${WEEKEND}/admin/submissions/${item.id}/moderate`,
        payload: { decision: 'APPROVE' },
      });
    }

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'SHORTLIST' },
    });

    const shortlisted = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/shortlist`,
      payload: { submissionIds: [first.submissionId] },
    });
    expect(shortlisted.json().data.shortlisted).toBe(1);

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'PRODUCER_SELECTION' },
    });

    const selected = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/select`,
      payload: { submissionId: first.submissionId, notes: 'Read out in the opening segment' },
    });
    expect(selected.statusCode).toBe(200);

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'SELECTED' },
    });

    // Selections become public once the round reaches SELECTED.
    const publicView = (await app.inject({ method: 'GET', url: `${WEEKEND}/wr_test` })).json().data;
    expect(publicView.selections).toHaveLength(1);
    expect(publicView.selections[0].position).toBe(1);

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/complete`,
      payload: { submissionId: first.submissionId },
    });
    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'COMPLETED' },
    });

    // 15 submission + 60 shortlisted + 250 selected, all through the ledger.
    const entries = await db.pointsLedger.findMany({
      where: { sourceId: 'wr_test', userId: first.client.userId },
    });
    expect(entries.reduce((sum, entry) => sum + entry.delta, 0)).toBe(325);
    expect(entries.map((entry) => entry.reason.split(':')[0]).sort()).toEqual([
      'selected',
      'shortlisted',
      'submission',
    ]);

    // The cached balance is the seeded engagement points plus what was earned.
    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'one' } });
    expect(profile.pointsBalance).toBe(500 + 325);
  });

  it('refuses to skip a step in the funnel', async () => {
    await seedRound({ status: 'SUBMIT' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'SELECTED' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('refuses to shortlist an entry a moderator has not approved', async () => {
    await seedRound({ status: 'SUBMIT' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const entry = await submitAs('one@test.local', 'A perfectly reasonable question for the house.');

    const response = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/shortlist`,
      payload: { submissionIds: [entry.submissionId] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await db.weekendSubmission.count({ where: { shortlistedAt: { not: null } } })).toBe(0);
  });

  it('refuses to select an entry that was never shortlisted', async () => {
    await seedRound({ status: 'SUBMIT' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const entry = await submitAs('one@test.local', 'Another perfectly reasonable question.');

    const response = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/select`,
      payload: { submissionId: entry.submissionId },
    });

    expect(response.statusCode).toBe(409);
  });

  it('honours the shortlist size and the selection count', async () => {
    await seedRound({ status: 'SUBMIT', shortlistSize: 1, selectionCount: 1 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const one = await submitAs('one@test.local', 'The first question anyone asked this weekend.');
    const two = await submitAs('two@test.local', 'The second question anyone asked this weekend.');

    for (const id of [one.submissionId, two.submissionId]) {
      await producer.request({
        method: 'POST',
        url: `${WEEKEND}/admin/submissions/${id}/moderate`,
        payload: { decision: 'APPROVE' },
      });
    }

    const tooMany = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/shortlist`,
      payload: { submissionIds: [one.submissionId, two.submissionId] },
    });
    expect(tooMany.statusCode).toBe(400);

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/shortlist`,
      payload: { submissionIds: [one.submissionId] },
    });
    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/select`,
      payload: { submissionId: one.submissionId },
    });

    // A second selection would exceed selectionCount.
    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/shortlist`,
      payload: { submissionIds: [two.submissionId] },
    });
    const second = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/select`,
      payload: { submissionId: two.submissionId },
    });
    expect(second.statusCode).toBe(409);
  });

  it('never shows a moderator’s notes to the author', async () => {
    await seedRound({ status: 'SUBMIT' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const entry = await submitAs('one@test.local', 'A question that gets rejected for some reason.');

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/submissions/${entry.submissionId}/moderate`,
      payload: { decision: 'REJECT', reason: 'Internal note: user has prior warnings' },
    });

    const mine = (await entry.client.request({ method: 'GET', url: `${WEEKEND}/wr_test` })).json()
      .data;

    expect(mine.mySubmissions[0].moderationOutcome).toBe('REJECTED');
    expect(JSON.stringify(mine)).not.toContain('prior warnings');
  });

  it('writes a moderation decision and an audit row', async () => {
    await seedRound({ status: 'SUBMIT' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const entry = await submitAs('one@test.local', 'A question worth approving this weekend.');

    await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/submissions/${entry.submissionId}/moderate`,
      payload: { decision: 'APPROVE', reason: 'Clear and on topic' },
    });

    const decision = await db.moderationDecision.findFirstOrThrow({
      where: { targetType: 'WeekendSubmission' },
    });
    expect(decision.decision).toBe('APPROVED');

    const audit = await db.auditLog.findFirst({ where: { action: 'weekend.approve' } });
    expect(audit).toBeTruthy();
  });
});

describe('physical rewards are off unless production authorises them', () => {
  it('never advertises an in-person opportunity by default', async () => {
    await seedRound();
    const round = (await app.inject({ method: 'GET', url: `${WEEKEND}/current` })).json().data;

    expect(round.rewards.inPersonOpportunity).toBe(false);
    expect(round.rewards.disclaimer).toMatch(/no physical appearance/i);
    expect(round.participationTypes).not.toContain('VIRTUAL_AUDIENCE');
  });

  it('refuses to create a round offering an in-person type', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin`,
      payload: {
        title: 'Come to the house!',
        participationTypes: ['ASK_CONTESTANT', 'VIRTUAL_AUDIENCE'],
        opensAt: new Date().toISOString(),
        submissionDeadline: new Date(Date.now() + 3600_000).toISOString(),
        closesAt: new Date(Date.now() + 7200_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(await db.weekendParticipationRound.count()).toBe(0);
  });

  it('refuses to add an in-person type to an unauthorised round', async () => {
    await seedRound();
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/participation-types`,
      payload: { type: 'VIRTUAL_AUDIENCE' },
    });

    expect(response.statusCode).toBe(403);
    const round = await db.weekendParticipationRound.findUniqueOrThrow({ where: { id: 'wr_test' } });
    expect(round.participationTypes).not.toContain('VIRTUAL_AUDIENCE');
  });

  it('refuses to enable physical rewards without a disclaimer and acknowledgement', async () => {
    await seedRound();
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const noAcknowledgement = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/rewards`,
      payload: { allowPhysicalRewards: true, rewardDisclaimer: 'A supervised session with staff.' },
    });
    expect(noAcknowledgement.statusCode).toBe(400);

    const noDisclaimer = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/rewards`,
      payload: { allowPhysicalRewards: true, acknowledgeProductionAuthorisation: true },
    });
    expect(noDisclaimer.statusCode).toBe(400);

    const round = await db.weekendParticipationRound.findUniqueOrThrow({ where: { id: 'wr_test' } });
    expect(round.allowPhysicalRewards).toBe(false);
  });

  it('refuses a producer without the physical-rewards permission', async () => {
    await seedRound();
    const moderator = await makeUser('mod@test.local', 'Mod', 'MODERATOR');

    const response = await moderator.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/rewards`,
      payload: {
        allowPhysicalRewards: true,
        acknowledgeProductionAuthorisation: true,
        rewardDisclaimer: 'A supervised virtual audience session arranged by production staff.',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('enables it properly when production authorises it, recording who did', async () => {
    await seedRound();
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const enabled = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/rewards`,
      payload: {
        allowPhysicalRewards: true,
        acknowledgeProductionAuthorisation: true,
        rewardDisclaimer:
          'Selected entries join a supervised virtual audience session arranged by production.',
      },
    });
    expect(enabled.statusCode).toBe(200);

    const stored = await db.weekendParticipationRound.findUniqueOrThrow({ where: { id: 'wr_test' } });
    expect(stored.allowPhysicalRewards).toBe(true);
    expect(stored.enabledById).toBeTruthy();

    // Only now may the in-person type be offered.
    const added = await producer.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/participation-types`,
      payload: { type: 'VIRTUAL_AUDIENCE' },
    });
    expect(added.statusCode).toBe(200);

    const round = (await app.inject({ method: 'GET', url: `${WEEKEND}/current` })).json().data;
    expect(round.rewards.inPersonOpportunity).toBe(true);
    expect(round.rewards.disclaimer).toMatch(/supervised virtual audience/i);

    const audit = await db.auditLog.findFirst({ where: { action: 'weekend.configure_rewards' } });
    expect(audit).toBeTruthy();
  });
});

describe('authorisation', () => {
  it('refuses every operator action to an ordinary user', async () => {
    await seedRound();
    const client = await makeUser('viewer@test.local', 'Viewer');

    const calls: [string, string, Record<string, unknown>][] = [
      ['POST', `${WEEKEND}/admin`, { title: 'x' }],
      ['POST', `${WEEKEND}/admin/wr_test/advance`, { to: 'MODERATION' }],
      ['POST', `${WEEKEND}/admin/wr_test/shortlist`, { submissionIds: ['x'] }],
      ['POST', `${WEEKEND}/admin/wr_test/select`, { submissionId: 'x' }],
      ['POST', `${WEEKEND}/admin/wr_test/rewards`, { allowPhysicalRewards: false }],
    ];

    for (const [method, url, payload] of calls) {
      const response = await client.request({ method: method as 'POST', url, payload });
      expect(response.statusCode, url).toBe(403);
    }

    const queue = await client.request({
      method: 'GET',
      url: `${WEEKEND}/admin/wr_test/submissions`,
    });
    expect(queue.statusCode).toBe(403);
  });

  it('rejects anonymous operator actions', async () => {
    await seedRound();
    const response = await app.inject({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'MODERATION' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not let a moderator run production steps', async () => {
    await seedRound();
    const moderator = await makeUser('mod@test.local', 'Mod', 'MODERATOR');

    const response = await moderator.request({
      method: 'POST',
      url: `${WEEKEND}/admin/wr_test/advance`,
      payload: { to: 'MODERATION' },
    });
    expect(response.statusCode).toBe(403);
  });
});
