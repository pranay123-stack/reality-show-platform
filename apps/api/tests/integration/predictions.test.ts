import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const PREDICTIONS = `${API_PREFIX}/predictions`;

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
  role: 'USER' | 'PRODUCER' = 'USER',
  verified = true,
) {
  await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: await hashPassword(VALID_PASSWORD),
      role,
      status: 'ACTIVE',
      emailVerifiedAt: verified ? new Date() : null,
      profile: { create: { displayName } },
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

async function seedShow() {
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.pointsRule.createMany({
    data: [
      { key: 'PREDICTION_PARTICIPATION', points: 5 },
      { key: 'PREDICTION_CORRECT', points: 50 },
    ],
  });
}

async function seedOpenPrediction(closesInMs = 60_000) {
  return db.prediction.create({
    data: {
      id: 'pred_test',
      showId: 'show_test',
      question: 'Who wins tonight?',
      status: 'OPEN',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + closesInMs),
      participationPoints: 5,
      rewardPoints: 50,
      options: {
        create: [
          { id: 'opt_a', label: 'Contestant A', sortOrder: 0 },
          { id: 'opt_b', label: 'Contestant B', sortOrder: 1 },
        ],
      },
    },
    include: { options: true },
  });
}

beforeEach(async () => {
  await resetAll();
  await seedShow();
});

describe('submitting a prediction', () => {
  it('records the entry and awards participation points', async () => {
    await seedOpenPrediction();
    const client = await makeUser('player@test.local', 'Player');

    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.prediction.myOptionId).toBe('opt_a');
    expect(body.pointsAwarded).toBe(5);
    expect(body.balance).toBe(5);

    const ledger = await db.pointsLedger.findMany({ where: { sourceId: 'pred_test' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.reason).toBe('participation');
    expect(ledger[0]!.balanceAfter).toBe(5);
  });

  it('refuses a second prediction on the same question', async () => {
    await seedOpenPrediction();
    const client = await makeUser('player@test.local', 'Player');

    await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });

    const second = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_b' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('PREDICTION_ALREADY_SUBMITTED');

    // The original entry is untouched and no extra points were paid.
    expect(await db.predictionEntry.count({ where: { predictionId: 'pred_test' } })).toBe(1);
    expect(await db.pointsLedger.count({ where: { sourceId: 'pred_test' } })).toBe(1);
  });

  it('refuses an entry once the deadline has passed, even while the status still says OPEN', async () => {
    await db.prediction.create({
      data: {
        id: 'pred_expired',
        showId: 'show_test',
        question: 'Already over?',
        status: 'OPEN',
        opensAt: new Date(Date.now() - 120_000),
        // Deliberately in the past with no close job having run.
        closesAt: new Date(Date.now() - 1000),
        options: { create: [{ id: 'opt_x', label: 'X' }, { id: 'opt_y', label: 'Y' }] },
      },
    });

    const client = await makeUser('player@test.local', 'Player');
    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_expired/entries`,
      payload: { optionId: 'opt_x' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PREDICTION_CLOSED');
    expect(await db.predictionEntry.count()).toBe(0);
  });

  it('refuses an entry on a resolved prediction', async () => {
    await db.prediction.create({
      data: {
        id: 'pred_done',
        showId: 'show_test',
        question: 'Finished',
        status: 'RESOLVED',
        closesAt: new Date(Date.now() - 60_000),
        resolvedAt: new Date(),
        options: { create: [{ id: 'opt_p', label: 'P' }, { id: 'opt_q', label: 'Q' }] },
      },
    });

    const client = await makeUser('player@test.local', 'Player');
    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_done/entries`,
      payload: { optionId: 'opt_p' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PREDICTION_CLOSED');
  });

  it('rejects an option that belongs to another prediction', async () => {
    await seedOpenPrediction();
    const client = await makeUser('player@test.local', 'Player');

    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_from_nowhere' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('OPTION_INVALID');
  });

  it('requires a confirmed email address', async () => {
    await seedOpenPrediction();
    const client = await makeUser('unverified@test.local', 'Unverified', 'USER', false);

    const response = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects an anonymous entry', async () => {
    await seedOpenPrediction();
    const response = await app.inject({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('reading predictions', () => {
  it('hides the entry distribution until the question is resolved', async () => {
    await seedOpenPrediction();
    const client = await makeUser('player@test.local', 'Player');
    await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });

    const view = (await client.request({ method: 'GET', url: `${PREDICTIONS}/pred_test` })).json()
      .data;

    expect(view.entryCount).toBe(1);
    // Per-option counts stay at zero so nobody can follow the crowd.
    expect(view.options.every((option: { entryCount: number }) => option.entryCount === 0)).toBe(
      true,
    );
    expect(view.correctOptionId).toBeNull();
  });

  it('marks a prediction closed once the deadline passes', async () => {
    await seedOpenPrediction(-1000);
    const view = (await app.inject({ method: 'GET', url: `${PREDICTIONS}/pred_test` })).json().data;
    expect(view.isClosed).toBe(true);
  });
});

describe('operator lifecycle', () => {
  it('refuses lifecycle actions to an ordinary user', async () => {
    await seedOpenPrediction();
    const client = await makeUser('player@test.local', 'Player');

    for (const path of ['activate', 'close', 'cancel']) {
      const response = await client.request({
        method: 'POST',
        url: `${PREDICTIONS}/admin/pred_test/${path}`,
      });
      expect(response.statusCode, path).toBe(403);
    }

    const resolve = await client.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/pred_test/resolve`,
      payload: { correctOptionId: 'opt_a' },
    });
    expect(resolve.statusCode).toBe(403);
  });

  it('resolves, credits only correct entries, and writes an audit row', async () => {
    await seedOpenPrediction();
    const winner = await makeUser('winner@test.local', 'Winner');
    const loser = await makeUser('loser@test.local', 'Loser');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    await winner.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });
    await loser.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_b' },
    });

    const response = await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/pred_test/resolve`,
      payload: { correctOptionId: 'opt_a', notes: 'Checked against the recording' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      totalEntries: 2,
      correctEntries: 1,
      usersCredited: 1,
    });

    const winnerProfile = await db.userProfile.findFirstOrThrow({
      where: { displayName: 'Winner' },
    });
    const loserProfile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Loser' } });

    expect(winnerProfile.pointsBalance).toBe(55); // 5 participation + 50 correct
    expect(loserProfile.pointsBalance).toBe(5); // participation only

    const audit = await db.auditLog.findFirst({ where: { action: 'prediction.resolve' } });
    expect(audit).toBeTruthy();
    expect(audit!.entityId).toBe('pred_test');
  });

  it('is idempotent: resolving twice never pays twice', async () => {
    await seedOpenPrediction();
    const winner = await makeUser('winner@test.local', 'Winner');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    await winner.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_test/entries`,
      payload: { optionId: 'opt_a' },
    });

    await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/pred_test/resolve`,
      payload: { correctOptionId: 'opt_a' },
    });

    // A second resolve is refused by the state machine…
    const second = await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/pred_test/resolve`,
      payload: { correctOptionId: 'opt_a' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('INVALID_STATE_TRANSITION');

    // …and the ledger's unique constraint means the payout cannot repeat anyway.
    const correctEntries = await db.pointsLedger.findMany({
      where: { sourceId: 'pred_test', reason: 'correct' },
    });
    expect(correctEntries).toHaveLength(1);

    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Winner' } });
    expect(profile.pointsBalance).toBe(55);
  });

  it('refuses to resolve with an option from another question', async () => {
    await seedOpenPrediction();
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/pred_test/resolve`,
      payload: { correctOptionId: 'not_an_option' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('OPTION_INVALID');
  });

  it('will not open a draft whose close time has already passed', async () => {
    await db.prediction.create({
      data: {
        id: 'pred_draft',
        showId: 'show_test',
        question: 'Too late',
        status: 'DRAFT',
        closesAt: new Date(Date.now() - 1000),
        options: { create: [{ label: 'A' }, { label: 'B' }] },
      },
    });

    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const response = await producer.request({
      method: 'POST',
      url: `${PREDICTIONS}/admin/pred_draft/activate`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses to edit a prediction that is already live', async () => {
    await seedOpenPrediction();
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'PATCH',
      url: `${PREDICTIONS}/admin/pred_test`,
      payload: { question: 'Changed after opening' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });
});
