import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setMailer, type MailMessage } from '../../src/core/mailer.js';
import { hashPassword } from '../../src/core/password.js';
import { settleDomainEvents } from '../../src/core/domain-events.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, resetRedis, testPrisma as db } from '../helpers/db.js';

/**
 * End-to-end journeys.
 *
 * Every other integration file proves one module behaves. These prove the
 * modules add up to a product: a person signs up and reaches the leaderboard, a
 * producer runs an episode from an empty console, and an attacker gets nowhere.
 *
 * The steps are separate `it()` blocks sharing state on purpose. A journey that
 * fails at step nine should say "step nine" rather than dumping one enormous
 * assertion, and Vitest runs a file's tests in declaration order, so the shared
 * state is safe here. Each journey resets the world in its own `beforeAll`.
 */

const AUTH = `${API_PREFIX}/auth`;
const PREDICTIONS = `${API_PREFIX}/predictions`;
const POLLS = `${API_PREFIX}/polls`;
const CHALLENGES = `${API_PREFIX}/challenges`;
const PERSPECTIVES = `${API_PREFIX}/perspectives`;
const KITCHEN = `${API_PREFIX}/kitchen`;
const WEEKEND = `${API_PREFIX}/weekend`;
const REWARDS = `${API_PREFIX}/rewards`;
const LEADERBOARDS = `${API_PREFIX}/leaderboards`;
const CONTESTANTS = `${API_PREFIX}/contestants`;
const DASHBOARD = `${API_PREFIX}/dashboard`;
const ADMIN = `${API_PREFIX}/admin`;
const ANALYTICS = `${API_PREFIX}/analytics`;
const NOTIFICATIONS = `${API_PREFIX}/notifications`;

let app: FastifyInstance;
let passwordHash: string;
const outbox: MailMessage[] = [];

beforeAll(async () => {
  setMailer({
    async send(message) {
      outbox.push(message);
    },
  });
  app = await buildTestApp();
  passwordHash = await hashPassword(VALID_PASSWORD);
});

afterAll(async () => {
  setMailer(null);
  await app.close();
  await disconnectTestDatabase();
});

// ---------------------------------------------------------------------------
// Fixtures — one show with everything a journey needs to walk through.
// ---------------------------------------------------------------------------

async function seedWorld(): Promise<void> {
  await db.show.create({
    data: { id: 'show_j', slug: 'journey-show', name: 'Journey Show', status: 'LIVE' },
  });

  await db.pointsRule.createMany({
    data: [
      { key: 'PREDICTION_PARTICIPATION', points: 5 },
      { key: 'PREDICTION_CORRECT', points: 50 },
      { key: 'POLL_PARTICIPATION', points: 3 },
      { key: 'PERSPECTIVE_PARTICIPATION', points: 3 },
      { key: 'CHALLENGE_SUBMISSION', points: 10 },
      { key: 'KITCHEN_PARTICIPATION', points: 4 },
      { key: 'WEEKEND_SUBMISSION', points: 15 },
    ],
  });

  await db.contestant.createMany({
    data: [
      { id: 'con_j1', showId: 'show_j', slug: 'ada', displayName: 'Ada' },
      { id: 'con_j2', showId: 'show_j', slug: 'bo', displayName: 'Bo' },
    ],
  });

  await db.event.create({
    data: {
      id: 'evt_j',
      showId: 'show_j',
      type: 'ARGUMENT',
      title: 'The missing ingredient',
      description: 'A disagreement in the kitchen.',
      occurredAt: new Date(Date.now() - 3600_000),
    },
  });

  await db.prediction.create({
    data: {
      id: 'pred_j',
      showId: 'show_j',
      question: 'Who takes the immunity tonight?',
      status: 'OPEN',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      participationPoints: 5,
      rewardPoints: 50,
      options: {
        create: [
          { id: 'pj_a', label: 'Ada', contestantId: 'con_j1', sortOrder: 0 },
          { id: 'pj_b', label: 'Bo', contestantId: 'con_j2', sortOrder: 1 },
        ],
      },
    },
  });

  await db.livePoll.create({
    data: {
      id: 'poll_j',
      showId: 'show_j',
      question: 'Who handled that better?',
      status: 'ACTIVE',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      participationPoints: 3,
      options: {
        create: [
          { id: 'plj_a', label: 'Ada', sortOrder: 0 },
          { id: 'plj_b', label: 'Bo', sortOrder: 1 },
        ],
      },
    },
  });

  await db.audiencePerspective.create({
    data: {
      id: 'persp_j',
      showId: 'show_j',
      eventId: 'evt_j',
      question: 'In the kitchen argument, who was right?',
      status: 'OPEN',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      options: {
        create: [
          { id: 'poj_a', label: 'Ada was right', contestantId: 'con_j1', sortOrder: 0 },
          { id: 'poj_b', label: 'Bo was right', contestantId: 'con_j2', sortOrder: 1 },
        ],
      },
    },
  });

  await db.kitchenBudget.create({
    data: {
      id: 'budget_j',
      showId: 'show_j',
      label: 'Journey week budget',
      totalUnits: 5000,
      spentUnits: 0,
      currencySymbol: '₹',
      periodStart: new Date(Date.now() - 86_400_000),
      periodEnd: new Date(Date.now() + 86_400_000 * 5),
    },
  });

  await db.kitchenDecision.create({
    data: {
      id: 'kd_j',
      showId: 'show_j',
      budgetId: 'budget_j',
      title: 'Tomorrow’s main meal',
      question: 'What should the house prepare?',
      status: 'OPEN',
      opensAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 3600_000),
      maxSelections: 1,
      winnerCount: 1,
      participationPoints: 4,
      options: {
        create: [
          { id: 'koj_rice', label: 'Rice', kind: 'MENU', unitCost: 600, quantity: 4, unit: 'kg', sortOrder: 0 },
          { id: 'koj_pasta', label: 'Pasta', kind: 'MENU', unitCost: 500, quantity: 4, unit: 'kg', sortOrder: 1 },
        ],
      },
    },
  });

  await db.weekendParticipationRound.create({
    data: {
      id: 'wr_j',
      showId: 'show_j',
      title: 'Weekend — ask the house',
      description: 'Send a question for the weekend episode.',
      status: 'SUBMIT',
      participationTypes: ['ASK_CONTESTANT'],
      opensAt: new Date(Date.now() - 60_000),
      submissionDeadline: new Date(Date.now() + 3600_000),
      closesAt: new Date(Date.now() + 7200_000),
      shortlistSize: 10,
      selectionCount: 3,
      // Deliberately reachable by the journey's own earlier steps rather than
      // by a hand-set balance: this is what makes it an eligibility *test*.
      eligibilityConfig: { minPoints: 10, minActivities: 3, minDistinctFeatures: 2 },
      allowPhysicalRewards: false,
      questions: {
        create: [
          { id: 'wq_j', prompt: 'What would you ask a contestant?', type: 'ASK_CONTESTANT', maxLength: 400 },
        ],
      },
    },
  });

  await db.rewardCatalog.create({
    data: {
      id: 'rw_j',
      code: 'JOURNEY_BADGE',
      name: 'Journey badge',
      description: 'A digital badge.',
      category: 'DIGITAL',
      type: 'DIGITAL_BADGE',
      pointCost: 20,
      status: 'AVAILABLE',
      oncePerUser: true,
      requiresProductionApproval: false,
      inventory: { create: { totalUnits: 100, remaining: 100 } },
    },
  });
}

async function makeOperator(email: string, role: 'MODERATOR' | 'PRODUCER' | 'ADMIN') {
  await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash,
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: `${role} account` } },
    },
  });

  const client = new TestClient(app);
  await client.request({
    method: 'POST',
    url: `${AUTH}/login`,
    payload: { email, password: VALID_PASSWORD },
  });
  return client;
}

function tokenFromLink(text: string): string {
  const match = /token=([^\s&]+)/.exec(text);
  if (!match) throw new Error(`No token found in email:\n${text}`);
  return decodeURIComponent(match[1]!);
}

// ===========================================================================
// Journey 1 — a new viewer, from nothing to the leaderboard
// ===========================================================================

describe('journey: a new viewer', () => {
  const email = 'journey.viewer@example.com';
  let client: TestClient;
  let userId: string;

  beforeAll(async () => {
    await resetAll();
    outbox.length = 0;
    await seedWorld();
    client = new TestClient(app);
  });

  it('1. signs up and starts unverified', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${AUTH}/signup`,
      payload: {
        email,
        password: VALID_PASSWORD,
        displayName: 'JourneyViewer',
        acceptedTerms: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.user.status).toBe('PENDING_VERIFICATION');
    userId = response.json().data.user.id;
  });

  it('2. cannot take part until the address is confirmed', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_j/entries`,
      payload: { optionId: 'pj_a' },
    });

    // Participation is gated on a confirmed address — this is the gate working,
    // not a failure of the journey.
    expect(response.statusCode).toBe(403);
  });

  it('3. confirms the address from the emailed link', async () => {
    expect(outbox).toHaveLength(1);
    const response = await client.request({
      method: 'POST',
      url: `${AUTH}/verify-email`,
      payload: { token: tokenFromLink(outbox[0]!.text) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.emailVerified).toBe(true);
    expect(response.json().data.status).toBe('ACTIVE');
  });

  it('4. signs in on a fresh client', async () => {
    client = new TestClient(app);
    const response = await client.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email, password: VALID_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.emailVerified).toBe(true);
  });

  it('5. reaches a dashboard', async () => {
    const response = await client.request({ method: 'GET', url: DASHBOARD });
    expect(response.statusCode).toBe(200);
  });

  it('6. browses contestants and opens one', async () => {
    const list = await client.request({ method: 'GET', url: CONTESTANTS });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThan(0);

    const detail = await client.request({ method: 'GET', url: `${CONTESTANTS}/con_j1` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.displayName).toBe('Ada');
  });

  it('7. makes a prediction and is awarded participation points', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_j/entries`,
      payload: { optionId: 'pj_a' },
    });

    expect(response.statusCode).toBe(200);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.pointsBalance).toBe(5);
  });

  it('8. votes in a live poll', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${POLLS}/poll_j/vote`,
      payload: { optionId: 'plj_a' },
    });

    expect(response.statusCode).toBe(200);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.pointsBalance).toBe(8);
  });

  it('9. writes a challenge, which lands in moderation rather than in public', async () => {
    const response = await client.request({
      method: 'POST',
      url: CHALLENGES,
      payload: {
        title: 'Silent breakfast challenge',
        description: 'The whole house must get through breakfast without speaking a word.',
        category: 'FUNNY',
        targetType: 'HOUSE',
        submit: true,
      },
    });

    expect(response.statusCode).toBe(201);
    // Nothing reaches the community without a human first.
    expect(response.json().data.status).toBe('MODERATION');
  });

  it('10. votes on a perspective', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_j/vote`,
      payload: { optionId: 'poj_a' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('11. votes on tomorrow’s food', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_j/votes`,
      payload: { optionIds: ['koj_rice'] },
    });

    expect(response.statusCode).toBe(200);
  });

  it('12. has now earned weekend eligibility through genuinely different features', async () => {
    const response = await client.request({ method: 'GET', url: `${WEEKEND}/eligibility` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.eligibility.eligible).toBe(true);
  });

  it('13. submits a weekend entry', async () => {
    const response = await client.request({
      method: 'POST',
      url: `${WEEKEND}/wr_j/submissions`,
      payload: {
        participationType: 'ASK_CONTESTANT',
        questionId: 'wq_j',
        contestantId: 'con_j1',
        content: 'Ada, what was going through your head during the argument?',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.submission.status).toBe('SUBMITTED');
  });

  it('14. redeems a reward, and the points come off the balance', async () => {
    const before = await db.userProfile.findUniqueOrThrow({ where: { userId } });

    const response = await client.request({
      method: 'POST',
      url: `${REWARDS}/rw_j/redeem`,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const after = await db.userProfile.findUniqueOrThrow({ where: { userId } });
    expect(after.pointsBalance).toBe(before.pointsBalance - 20);
    // Spending must never cost a standing — that is the whole design.
    expect(after.lifetimePoints).toBe(before.lifetimePoints);
  });

  it('15. appears on the leaderboard, ranked on what was earned', async () => {
    const response = await client.request({
      method: 'GET',
      url: `${LEADERBOARDS}?scope=SEASON&window=SEASON`,
    });

    expect(response.statusCode).toBe(200);
    const me = response.json().data.me;
    expect(me).toBeTruthy();
    // Ranked on lifetime earnings, not on the balance the redemption reduced.
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId } });
    expect(me.points).toBe(profile.lifetimePoints);
  });

  it('16. was told what happened, without any feature importing notifications', async () => {
    await settleDomainEvents();
    const response = await client.request({ method: 'GET', url: NOTIFICATIONS });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().data.items)).toBe(true);
  });
});

// ===========================================================================
// Journey 2 — a producer running the episode
// ===========================================================================

describe('journey: a producer', () => {
  let producer: TestClient;
  let moderator: TestClient;
  let viewer: TestClient;
  let predictionId: string;
  let pollId: string;
  let challengeId: string;

  beforeAll(async () => {
    await resetAll();
    outbox.length = 0;
    await seedWorld();

    producer = await makeOperator('journey.producer@example.com', 'PRODUCER');
    moderator = await makeOperator('journey.moderator@example.com', 'MODERATOR');

    const email = 'journey.player@example.com';
    await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'JourneyPlayer', pointsBalance: 500, lifetimePoints: 500 } },
      },
    });
    viewer = new TestClient(app);
    await viewer.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email, password: VALID_PASSWORD },
    });
  });

  it('1. sees the console sections its role actually allows', async () => {
    const response = await producer.request({ method: 'GET', url: `${ADMIN}/sections` });

    expect(response.statusCode).toBe(200);
    const keys: string[] = response.json().data.sections;
    expect(keys).toContain('predictions');
    // Resolved server-side from permissions, never from the browser.
    expect(keys).not.toContain('audit');
  });

  it('2. creates a prediction as a draft', async () => {
    const response = await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin`,
      payload: {
        question: 'Who is nominated first tonight?',
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        participationPoints: 5,
        rewardPoints: 50,
        options: [{ label: 'Ada' }, { label: 'Bo' }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.status).toBe('DRAFT');
    predictionId = response.json().data.id;
  });

  it('3. can still find the draft it just created', async () => {
    const response = await producer.request({ method: 'GET', url: `${PREDICTIONS}/admin/list` });

    expect(response.statusCode).toBe(200);
    const ids: string[] = response.json().data.map((row: { id: string }) => row.id);
    expect(ids).toContain(predictionId);
  });

  it('4. activates it, and only then can a viewer answer', async () => {
    const early = await viewer.request({
      method: 'POST',
      url: `${PREDICTIONS}/${predictionId}/entries`,
      payload: { optionId: 'x' },
    });
    expect(early.statusCode).toBeGreaterThanOrEqual(400);

    const activate = await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/${predictionId}/activate`,
      payload: {},
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().data.status).toBe('OPEN');
  });

  it('5. creates and activates a poll', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${POLLS}/admin`,
      payload: {
        question: 'Was that fair?',
        durationSeconds: 120,
        participationPoints: 3,
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    });
    expect(created.statusCode).toBe(201);
    pollId = created.json().data.id;

    const activated = await producer.request({
      method: 'POST',
      url: `${POLLS}/admin/${pollId}/activate`,
      payload: {},
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().data.status).toBe('ACTIVE');
  });

  it('6. a moderator reviews an audience challenge before anyone votes on it', async () => {
    const submitted = await viewer.request({
      method: 'POST',
      url: CHALLENGES,
      payload: {
        title: 'The great sock hunt',
        description: 'Hide every left sock in the house and see how long it takes to notice.',
        category: 'FUNNY',
        targetType: 'HOUSE',
        submit: true,
      },
    });
    expect(submitted.statusCode).toBe(201);
    challengeId = submitted.json().data.id;

    // Roles are cumulative: a producer holds every moderator permission, so
    // the boundary worth asserting is the one below it.
    const refused = await viewer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${challengeId}/moderate`,
      payload: { decision: 'APPROVE' },
    });
    expect(refused.statusCode).toBe(403);

    const approved = await moderator.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${challengeId}/moderate`,
      payload: { decision: 'APPROVE' },
    });
    expect(approved.statusCode).toBe(200);
  });

  it('7. approves a weekend submission', async () => {
    const submission = await db.weekendSubmission.create({
      data: {
        roundId: 'wr_j',
        userId: (await db.user.findFirstOrThrow({ where: { email: 'journey.player@example.com' } })).id,
        participationType: 'ASK_CONTESTANT',
        questionId: 'wq_j',
        content: 'What is the one thing you regret this week?',
        status: 'IN_MODERATION',
      },
    });

    const response = await moderator.request({
      method: 'POST',
      url: `${WEEKEND}/admin/submissions/${submission.id}/moderate`,
      payload: { decision: 'APPROVE' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('8. manages the reward catalogue', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin`,
      payload: {
        code: 'JOURNEY_SHOUTOUT',
        name: 'On-air shout-out',
        category: 'DIGITAL',
        type: 'SHOUTOUT',
        pointCost: 100,
        totalUnits: 5,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data.status).toBe('DRAFT');
  });

  it('9. reads analytics built from aggregates', async () => {
    const response = await producer.request({
      method: 'GET',
      url: `${ANALYTICS}/admin/overview?days=7`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveProperty('engagementFunnel');
  });

  it('10. cannot read the audit log, and an admin can', async () => {
    const refused = await producer.request({ method: 'GET', url: `${ADMIN}/audit` });
    expect(refused.statusCode).toBe(403);

    const admin = await makeOperator('journey.admin@example.com', 'ADMIN');
    const allowed = await admin.request({ method: 'GET', url: `${ADMIN}/audit` });
    expect(allowed.statusCode).toBe(200);

    // Every operator action above left a trail.
    const actions: string[] = allowed
      .json()
      .data.items.map((row: { action: string }) => row.action);
    expect(actions).toContain('prediction.create');
    expect(actions).toContain('poll.create');
  });
});

// ===========================================================================
// Journey 3 — an attacker
// ===========================================================================

describe('journey: an attacker', () => {
  let attacker: TestClient;
  let attackerId: string;

  beforeAll(async () => {
    await resetAll();
    outbox.length = 0;
    await seedWorld();

    const email = 'journey.attacker@example.com';
    const user = await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'Attacker', pointsBalance: 10, lifetimePoints: 10 } },
      },
    });
    attackerId = user.id;

    attacker = new TestClient(app);
    await attacker.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email, password: VALID_PASSWORD },
    });
  });

  it('cannot reach any console section as an ordinary user', async () => {
    for (const path of [
      `${ADMIN}/overview`,
      `${ADMIN}/audit`,
      `${PREDICTIONS}/admin/list`,
      `${REWARDS}/admin/catalogue`,
      `${ANALYTICS}/admin/overview`,
    ]) {
      const response = await attacker.request({ method: 'GET', url: path });
      expect(response.statusCode, `${path} should be refused`).toBe(403);
    }
  });

  it('cannot promote itself by asking', async () => {
    const response = await attacker.request({
      method: 'PATCH',
      url: `${API_PREFIX}/users/me`,
      payload: { role: 'ADMIN', permissions: ['audit.view'] },
    });

    // Either the field is rejected outright or it is ignored; what must not
    // happen is the role changing.
    const user = await db.user.findUniqueOrThrow({ where: { id: attackerId } });
    expect(user.role).toBe('USER');
    expect([200, 400]).toContain(response.statusCode);
  });

  it('cannot vote twice on the same poll', async () => {
    const first = await attacker.request({
      method: 'POST',
      url: `${POLLS}/poll_j/vote`,
      payload: { optionId: 'plj_a' },
    });
    expect(first.statusCode).toBe(200);

    const second = await attacker.request({
      method: 'POST',
      url: `${POLLS}/poll_j/vote`,
      payload: { optionId: 'plj_b' },
    });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);

    expect(await db.pollVote.count({ where: { pollId: 'poll_j', userId: attackerId } })).toBe(1);
  });

  it('cannot predict twice on the same question', async () => {
    await attacker.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_j/entries`,
      payload: { optionId: 'pj_a' },
    });
    const second = await attacker.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_j/entries`,
      payload: { optionId: 'pj_b' },
    });

    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      await db.predictionEntry.count({ where: { predictionId: 'pred_j', userId: attackerId } }),
    ).toBe(1);
  });

  it('cannot award itself points by sending them', async () => {
    const before = await db.userProfile.findUniqueOrThrow({ where: { userId: attackerId } });

    await attacker.request({
      method: 'POST',
      url: `${KITCHEN}/kd_j/votes`,
      payload: { optionIds: ['koj_rice'], points: 100_000, pointsAwarded: 100_000 },
    });

    const after = await db.userProfile.findUniqueOrThrow({ where: { userId: attackerId } });
    // Whatever it earned came from the server's own rule, not from the payload.
    expect(after.pointsBalance - before.pointsBalance).toBeLessThan(100);
  });

  it('cannot redeem a reward it cannot afford', async () => {
    await db.userProfile.update({
      where: { userId: attackerId },
      data: { pointsBalance: 5 },
    });

    const response = await attacker.request({
      method: 'POST',
      url: `${REWARDS}/rw_j/redeem`,
      payload: {},
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await db.rewardRedemption.count({ where: { userId: attackerId } })).toBe(0);
  });

  it('cannot redeem a once-per-user reward twice', async () => {
    await db.userProfile.update({
      where: { userId: attackerId },
      data: { pointsBalance: 1000 },
    });

    const first = await attacker.request({
      method: 'POST',
      url: `${REWARDS}/rw_j/redeem`,
      payload: {},
    });
    expect(first.statusCode).toBe(201);

    const second = await attacker.request({
      method: 'POST',
      url: `${REWARDS}/rw_j/redeem`,
      payload: {},
    });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    expect(await db.rewardRedemption.count({ where: { userId: attackerId } })).toBe(1);
  });

  it('cannot keep using a session after it is signed out', async () => {
    const stolen = new TestClient(app);
    await stolen.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'journey.attacker@example.com', password: VALID_PASSWORD },
    });

    const cookies = stolen.cookieHeader;
    await stolen.request({ method: 'POST', url: `${AUTH}/logout`, payload: {} });

    // The captured cookies, replayed after logout.
    const replayed = await app.inject({
      method: 'GET',
      url: `${AUTH}/me`,
      headers: { cookie: cookies },
    });

    expect(replayed.statusCode).toBe(401);
  });

  it('cannot act on a cross-site request with no CSRF token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${POLLS}/poll_j/vote`,
      headers: { cookie: attacker.cookieHeader },
      payload: { optionId: 'plj_b' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('cannot participate at all once suspended', async () => {
    await db.user.update({ where: { id: attackerId }, data: { status: 'SUSPENDED' } });
    // Authorisation reads a cached session, so a direct status write only takes
    // effect once that cache is dropped — which is what the admin suspend path
    // does. Without this the account keeps its access until the entry expires.
    await resetRedis();

    const response = await attacker.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_j/vote`,
      payload: { optionId: 'poj_a' },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(401);
  });
});
