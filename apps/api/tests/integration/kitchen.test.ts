import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const KITCHEN = `${API_PREFIX}/kitchen`;

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
  await db.user.create({
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
  return client;
}

beforeEach(async () => {
  await resetAll();
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.kitchenBudget.create({
    data: {
      id: 'budget_test',
      showId: 'show_test',
      label: 'Week 12 food budget',
      totalUnits: 5000,
      spentUnits: 0,
      currencySymbol: '₹',
      periodStart: new Date(Date.now() - 86_400_000),
      periodEnd: new Date(Date.now() + 86_400_000 * 5),
    },
  });
});

interface DecisionOptions {
  status?: 'DRAFT' | 'OPEN' | 'CLOSED' | 'FINALIZED';
  maxSelections?: number;
  winnerCount?: number;
  maxQuantity?: number | null;
  closesInMs?: number;
  bonusPoints?: number;
  budgetTotal?: number;
  budgetSpent?: number;
}

async function seedDecision(options: DecisionOptions = {}) {
  if (options.budgetTotal !== undefined || options.budgetSpent !== undefined) {
    await db.kitchenBudget.update({
      where: { id: 'budget_test' },
      data: {
        ...(options.budgetTotal !== undefined ? { totalUnits: options.budgetTotal } : {}),
        ...(options.budgetSpent !== undefined ? { spentUnits: options.budgetSpent } : {}),
      },
    });
  }

  return db.kitchenDecision.create({
    data: {
      id: 'kd_test',
      showId: 'show_test',
      budgetId: 'budget_test',
      title: 'Tomorrow’s main meal',
      question: 'What should the house prepare?',
      status: options.status ?? 'OPEN',
      opensAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + (options.closesInMs ?? 3600_000)),
      maxSelections: options.maxSelections ?? 1,
      winnerCount: options.winnerCount ?? 1,
      maxQuantity: options.maxQuantity ?? null,
      participationPoints: 4,
      bonusPoints: options.bonusPoints ?? 0,
      options: {
        create: [
          { id: 'ko_rice', label: 'Rice', kind: 'MENU', unitCost: 600, quantity: 4, unit: 'kg', sortOrder: 0 },
          { id: 'ko_pasta', label: 'Pasta', kind: 'MENU', unitCost: 500, quantity: 4, unit: 'kg', sortOrder: 1 },
          { id: 'ko_veg', label: 'Vegetables', kind: 'MENU', unitCost: 900, quantity: 5, unit: 'kg', sortOrder: 2 },
          { id: 'ko_dessert', label: 'Dessert', kind: 'SPECIAL', unitCost: 1500, quantity: 1, unit: 'batch', sortOrder: 3 },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 1. User sees active kitchen decision
// ---------------------------------------------------------------------------

describe('1. viewing active decisions', () => {
  it('lists the open decision with its options and budget', async () => {
    await seedDecision();
    const client = await makeUser('viewer@test.local', 'Viewer');

    const response = await client.request({ method: 'GET', url: `${KITCHEN}?scope=open` });

    expect(response.statusCode).toBe(200);
    const [decision] = response.json().data;
    expect(decision.id).toBe('kd_test');
    expect(decision.question).toBe('What should the house prepare?');
    expect(decision.isOpen).toBe(true);
    expect(decision.options).toHaveLength(4);
    expect(decision.budget).toMatchObject({
      totalUnits: 5000,
      spentUnits: 0,
      remainingUnits: 5000,
      currencySymbol: '₹',
    });
    expect(decision.selectionsRemaining).toBe(1);
    expect(decision.hasParticipated).toBe(false);
  });

  it('shows costs but hides the vote split while voting is open', async () => {
    await seedDecision({ maxSelections: 1 });
    const voter = await makeUser('voter@test.local', 'Voter');
    await voter.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    const anonymous = (await app.inject({ method: 'GET', url: `${KITCHEN}/kd_test` })).json().data;

    // Cost is public: people should know what their choice costs the house.
    expect(anonymous.options.find((o: { id: string }) => o.id === 'ko_rice').unitCost).toBe(600);
    // The split is not, until it is finalised.
    expect(anonymous.options.every((o: { voteCount: number }) => o.voteCount === 0)).toBe(true);
    // Participation volume is fine to share.
    expect(anonymous.totalVotes).toBe(1);
  });

  it('does not expose a draft decision', async () => {
    await seedDecision({ status: 'DRAFT' });
    expect((await app.inject({ method: 'GET', url: `${KITCHEN}/kd_test` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${KITCHEN}?scope=all` })).json().data).toHaveLength(0);
  });

  it('marks an option the budget can no longer afford as unaffordable', async () => {
    await seedDecision({ budgetTotal: 5000, budgetSpent: 4400 });
    const view = (await app.inject({ method: 'GET', url: `${KITCHEN}/kd_test` })).json().data;

    const byId = Object.fromEntries(
      view.options.map((o: { id: string; affordable: boolean }) => [o.id, o.affordable]),
    );
    expect(byId.ko_rice).toBe(true); // 600 <= 600 remaining
    expect(byId.ko_dessert).toBe(false); // 1500 > 600 remaining
  });
});

// ---------------------------------------------------------------------------
// 2. User votes successfully
// ---------------------------------------------------------------------------

describe('2. voting', () => {
  it('records the pick and credits participation through the ledger', async () => {
    await seedDecision();
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.selectionsUsed).toBe(1);
    expect(body.selectionsRemaining).toBe(0);
    expect(body.pointsAwarded).toBe(4);
    expect(body.decision.hasParticipated).toBe(true);

    expect(await db.kitchenVote.count()).toBe(1);
    const option = await db.kitchenOption.findUniqueOrThrow({ where: { id: 'ko_rice' } });
    expect(option.voteCount).toBe(1);

    const ledger = await db.pointsLedger.findMany({ where: { sourceId: 'kd_test' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ sourceType: 'KITCHEN', reason: 'participation', delta: 4 });

    // The balance moved through the ledger, never by direct assignment.
    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Voter' } });
    expect(profile.pointsBalance).toBe(4);
  });

  it('accepts several picks at once when the decision allows it', async () => {
    await seedDecision({ maxSelections: 2 });
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice', 'ko_veg'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.selectionsRemaining).toBe(0);
    expect(await db.kitchenVote.count()).toBe(2);

    // Participation is credited once per decision, not once per pick.
    expect(await db.pointsLedger.count({ where: { sourceId: 'kd_test' } })).toBe(1);
  });

  it('lets a user withdraw a pick and re-cast it', async () => {
    await seedDecision({ maxSelections: 1 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });
    const withdrawn = await client.request({
      method: 'DELETE',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionId: 'ko_rice' },
    });
    expect(withdrawn.json().data.selectionsRemaining).toBe(1);

    const recast = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_pasta'] },
    });
    expect(recast.statusCode).toBe(200);
    expect(await db.kitchenVote.count()).toBe(1);
  });

  it('rejects an option from another decision', async () => {
    await seedDecision();
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_not_here'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('OPTION_INVALID');
  });

  it('rejects anonymous and unverified voters', async () => {
    await seedDecision();

    const anonymous = await app.inject({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });
    expect(anonymous.statusCode).toBe(401);

    await db.user.create({
      data: {
        email: 'unverified@test.local',
        emailNormalized: 'unverified@test.local',
        passwordHash: await hashPassword(VALID_PASSWORD),
        status: 'ACTIVE',
        emailVerifiedAt: null,
        profile: { create: { displayName: 'Unverified' } },
      },
    });
    const unverified = new TestClient(app);
    await unverified.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'unverified@test.local', password: VALID_PASSWORD },
    });

    const response = await unverified.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate vote blocked
// ---------------------------------------------------------------------------

describe('3. duplicate votes', () => {
  it('blocks picking the same option twice', async () => {
    await seedDecision({ maxSelections: 3 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });
    const duplicate = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('VOTE_DUPLICATE');

    expect(await db.kitchenVote.count()).toBe(1);
    const option = await db.kitchenOption.findUniqueOrThrow({ where: { id: 'ko_rice' } });
    expect(option.voteCount).toBe(1);

    // Being refused must not have cost the user one of their picks.
    const allowance = await db.roundVoteAllowance.findFirstOrThrow();
    expect(allowance.votesUsed).toBe(1);
  });

  it('rejects the same option sent twice in one request', async () => {
    await seedDecision({ maxSelections: 3 });
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice', 'ko_rice'] },
    });

    expect(response.statusCode).toBe(400);
    expect(await db.kitchenVote.count()).toBe(0);
  });

  it('leaves no partial write when the second option of a pair is a duplicate', async () => {
    await seedDecision({ maxSelections: 3 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    const mixed = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_pasta', 'ko_rice'] },
    });

    expect(mixed.statusCode).toBe(409);
    // The whole request rolled back — pasta was not silently recorded.
    expect(await db.kitchenVote.count()).toBe(1);
    const pasta = await db.kitchenOption.findUniqueOrThrow({ where: { id: 'ko_pasta' } });
    expect(pasta.voteCount).toBe(0);
    const decision = await db.kitchenDecision.findUniqueOrThrow({ where: { id: 'kd_test' } });
    expect(decision.totalVotes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Closed decision rejects votes
// ---------------------------------------------------------------------------

describe('4. closed decisions', () => {
  it('rejects a vote once the status is CLOSED', async () => {
    await seedDecision({ status: 'CLOSED' });
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ROUND_CLOSED');
    expect(await db.kitchenVote.count()).toBe(0);
    expect(await db.pointsLedger.count()).toBe(0);
  });

  it('rejects a vote after the deadline even while the status still says OPEN', async () => {
    await seedDecision({ closesInMs: -1000 });
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ROUND_CLOSED');
    expect(await db.kitchenVote.count()).toBe(0);
  });

  it('rejects a vote before the decision opens', async () => {
    await db.kitchenDecision.create({
      data: {
        id: 'kd_future',
        showId: 'show_test',
        budgetId: 'budget_test',
        title: 'Later',
        question: 'Not yet?',
        status: 'OPEN',
        opensAt: new Date(Date.now() + 60_000),
        closesAt: new Date(Date.now() + 120_000),
        options: { create: [{ label: 'A', unitCost: 1 }, { label: 'B', unitCost: 1 }] },
      },
    });

    const client = await makeUser('voter@test.local', 'Voter');
    const option = await db.kitchenOption.findFirstOrThrow({ where: { decisionId: 'kd_future' } });

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_future/votes`,
      payload: { optionIds: [option.id] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/not opened yet/i);
  });

  it('refuses to withdraw a pick after the decision closes', async () => {
    await seedDecision();
    const client = await makeUser('voter@test.local', 'Voter');
    await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    await db.kitchenDecision.update({ where: { id: 'kd_test' }, data: { status: 'CLOSED' } });

    const response = await client.request({
      method: 'DELETE',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionId: 'ko_rice' },
    });

    expect(response.statusCode).toBe(409);
    expect(await db.kitchenVote.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Budget limits enforced
// ---------------------------------------------------------------------------

describe('5. budget limits', () => {
  it('refuses a vote for an option the house cannot afford', async () => {
    await seedDecision({ budgetTotal: 5000, budgetSpent: 4400 });
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_dessert'] }, // costs 1500, only 600 left
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('BUDGET_EXCEEDED');
    expect(await db.kitchenVote.count()).toBe(0);
  });

  it('drops an unaffordable option from the audience result and records why', async () => {
    await seedDecision({ winnerCount: 2, budgetTotal: 1000, budgetSpent: 0 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    // Dessert (1500) is unaffordable outright, so nobody may vote for it.
    // Vegetables (900) wins on votes; rice (600) then will not fit alongside it.
    const veg = await makeUser('veg@test.local', 'VegFan');
    const rice1 = await makeUser('rice1@test.local', 'RiceOne');
    await veg.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_veg'] },
    });
    await rice1.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_veg'] },
    });
    const riceFan = await makeUser('rice2@test.local', 'RiceTwo');
    await riceFan.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/close` });
    const published = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });

    const audience = published.json().data.audienceResult;
    expect(audience.selected.map((line: { optionId: string }) => line.optionId)).toEqual(['ko_veg']);
    expect(audience.totalCost).toBe(900);
    expect(audience.skipped).toEqual([
      expect.objectContaining({ optionId: 'ko_rice', reason: 'BUDGET' }),
    ]);

    // Publishing the audience view spends nothing.
    const budget = await db.kitchenBudget.findUniqueOrThrow({ where: { id: 'budget_test' } });
    expect(budget.spentUnits).toBe(0);
  });

  it('honours a quantity ceiling in the audience result', async () => {
    await seedDecision({ winnerCount: 3, maxQuantity: 5, budgetTotal: 100_000 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    // Vegetables must win outright: a 1-1 tie would be broken by the producer's
    // option ordering, which would test the tie-break rather than the ceiling.
    for (const index of [1, 2]) {
      const vegFan = await makeUser(`veg${index}@test.local`, `VegFan${index}`);
      await vegFan.request({
        method: 'POST',
        url: `${KITCHEN}/kd_test/votes`,
        payload: { optionIds: ['ko_veg'] }, // 5 kg — fills the ceiling
      });
    }
    const riceFan = await makeUser('rice@test.local', 'RiceFan');
    await riceFan.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] }, // 4 kg — would breach it
    });

    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/close` });
    const published = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });

    const audience = published.json().data.audienceResult;
    expect(audience.selected.map((l: { optionId: string }) => l.optionId)).toEqual(['ko_veg']);
    expect(audience.skipped[0]).toMatchObject({ optionId: 'ko_rice', reason: 'QUANTITY' });
  });

  it('refuses an implementation that would overdraw the budget, leaving spend untouched', async () => {
    await seedDecision({ status: 'CLOSED', budgetTotal: 2000, budgetSpent: 1000 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });

    const response = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_dessert'] }, // 1500 against 1000 remaining
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('BUDGET_EXCEEDED');

    const budget = await db.kitchenBudget.findUniqueOrThrow({ where: { id: 'budget_test' } });
    expect(budget.spentUnits).toBe(1000);
    const result = await db.kitchenResult.findUniqueOrThrow({ where: { decisionId: 'kd_test' } });
    expect(result.implementedAt).toBeNull();
  });

  it('spends the budget only when production records what it implemented', async () => {
    await seedDecision({ status: 'CLOSED', budgetTotal: 5000 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });
    expect((await db.kitchenBudget.findUniqueOrThrow({ where: { id: 'budget_test' } })).spentUnits).toBe(0);

    const implemented = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(implemented.statusCode).toBe(200);
    expect(implemented.json().data.cost).toBe(600);
    expect((await db.kitchenBudget.findUniqueOrThrow({ where: { id: 'budget_test' } })).spentUnits).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// 6. Concurrent voting behaves correctly
// ---------------------------------------------------------------------------

describe('6. concurrency', () => {
  it('never lets one user exceed their selection limit, however many requests race', async () => {
    await seedDecision({ maxSelections: 2 });
    const client = await makeUser('racer@test.local', 'Racer');

    const responses = await Promise.all(
      ['ko_rice', 'ko_pasta', 'ko_veg', 'ko_dessert'].map((optionId) =>
        client.request({
          method: 'POST',
          url: `${KITCHEN}/kd_test/votes`,
          payload: { optionIds: [optionId] },
        }),
      ),
    );

    const accepted = responses.filter((r) => r.statusCode === 200);
    const rejected = responses.filter((r) => r.statusCode === 409);

    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.json().error.code === 'VOTE_LIMIT_REACHED')).toBe(true);

    // Stored state agrees with what the clients were told.
    expect(await db.kitchenVote.count()).toBe(2);
    const allowance = await db.roundVoteAllowance.findFirstOrThrow();
    expect(allowance.votesUsed).toBe(2);
    const decision = await db.kitchenDecision.findUniqueOrThrow({ where: { id: 'kd_test' } });
    expect(decision.totalVotes).toBe(2);
  });

  it('counts every vote exactly once when many users vote at the same moment', async () => {
    await seedDecision({ maxSelections: 1 });

    const voters = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        makeUser(`voter${index}@test.local`, `Voter${index}`),
      ),
    );

    const responses = await Promise.all(
      voters.map((client, index) =>
        client.request({
          method: 'POST',
          url: `${KITCHEN}/kd_test/votes`,
          payload: { optionIds: [index % 2 === 0 ? 'ko_rice' : 'ko_pasta'] },
        }),
      ),
    );

    expect(responses.every((r) => r.statusCode === 200)).toBe(true);

    const decision = await db.kitchenDecision.findUniqueOrThrow({
      where: { id: 'kd_test' },
      include: { options: true },
    });
    const byId = Object.fromEntries(decision.options.map((o) => [o.id, o.voteCount]));

    expect(decision.totalVotes).toBe(10);
    expect(byId.ko_rice).toBe(5);
    expect(byId.ko_pasta).toBe(5);
    expect(await db.kitchenVote.count()).toBe(10);
    // The cached total equals the sum of the per-option counts.
    expect(decision.options.reduce((sum, o) => sum + o.voteCount, 0)).toBe(decision.totalVotes);
  });

  it('never half-applies a vote that races the close', async () => {
    await seedDecision({ maxSelections: 1 });
    const voters = await Promise.all(
      Array.from({ length: 8 }, (_, index) => makeUser(`racer${index}@test.local`, `Racer${index}`)),
    );

    const { closeDecision } = await import('../../src/modules/kitchen/kitchen.service.js');
    const results = await Promise.all([
      ...voters.map((client) =>
        client.request({
          method: 'POST',
          url: `${KITCHEN}/kd_test/votes`,
          payload: { optionIds: ['ko_rice'] },
        }),
      ),
      closeDecision('kd_test').catch(() => ({ closed: false })),
    ]);

    const votes = results.slice(0, voters.length) as { statusCode: number }[];
    const accepted = votes.filter((r) => r.statusCode === 200).length;

    const decision = await db.kitchenDecision.findUniqueOrThrow({
      where: { id: 'kd_test' },
      include: { options: true },
    });

    // Whatever the split, stored state must agree with the acks exactly.
    expect(await db.kitchenVote.count()).toBe(accepted);
    expect(decision.totalVotes).toBe(accepted);
    expect(decision.options.find((o) => o.id === 'ko_rice')?.voteCount).toBe(accepted);
    expect(await db.pointsLedger.count({ where: { sourceId: 'kd_test' } })).toBe(accepted);
  });
});

// ---------------------------------------------------------------------------
// 7. Audience result differs from implemented result
// ---------------------------------------------------------------------------

describe('7. audience decision versus official execution', () => {
  it('stores them separately and lets them disagree', async () => {
    await seedDecision({ winnerCount: 1, budgetTotal: 5000 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const one = await makeUser('one@test.local', 'One');
    const two = await makeUser('two@test.local', 'Two');
    await one.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });
    await two.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/close` });
    const published = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });

    const afterAudience = published.json().data;
    expect(afterAudience.status).toBe('FINALIZED');
    expect(afterAudience.audienceResult.kind).toBe('AUDIENCE_RESULT');
    expect(afterAudience.audienceResult.selected[0].optionId).toBe('ko_rice');
    expect(afterAudience.audienceResult.disclaimer).toMatch(/production team/i);
    // Publishing the audience view must not invent an implementation.
    expect(afterAudience.implementedResult).toBeNull();

    // Production gives the house something else entirely.
    const implemented = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_pasta'], note: 'Rice delivery did not arrive' },
    });

    expect(implemented.statusCode).toBe(200);
    const view = implemented.json().data.decision;

    expect(view.implementedResult.kind).toBe('IMPLEMENTED_RESULT');
    expect(view.implementedResult.source).toBe('production');
    expect(view.implementedResult.selected[0].optionId).toBe('ko_pasta');
    expect(view.implementedResult.matchesAudience).toBe(false);
    expect(view.implementedResult.note).toBe('Rice delivery did not arrive');

    // The audience record is untouched by the announcement.
    expect(view.audienceResult.selected[0].optionId).toBe('ko_rice');

    const stored = await db.kitchenResult.findUniqueOrThrow({ where: { decisionId: 'kd_test' } });
    expect(stored.audienceCost).toBe(600);
    expect(stored.implementedCost).toBe(500);
  });

  it('marks a match when production implements exactly what the audience chose', async () => {
    await seedDecision({ winnerCount: 1 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const voter = await makeUser('voter@test.local', 'Voter');

    await voter.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });
    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/close` });
    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });
    const implemented = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(implemented.json().data.decision.implementedResult.matchesAudience).toBe(true);
  });

  it('always ships the disclaimer, published or not', async () => {
    await seedDecision();
    const view = (await app.inject({ method: 'GET', url: `${KITCHEN}/kd_test` })).json().data;
    expect(view.disclaimer).toMatch(/production team/i);
  });

  it('pays the kitchen bonus only to users who backed what was implemented', async () => {
    await seedDecision({ winnerCount: 1, bonusPoints: 25 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const backer = await makeUser('backer@test.local', 'Backer');
    const other = await makeUser('other@test.local', 'Other');

    await backer.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_pasta'] },
    });
    await other.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'] },
    });

    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/close` });
    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });
    const implemented = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_pasta'] },
    });

    expect(implemented.json().data.usersRewarded).toBe(1);

    const backerProfile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Backer' } });
    const otherProfile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Other' } });
    expect(backerProfile.pointsBalance).toBe(29); // 4 participation + 25 bonus
    expect(otherProfile.pointsBalance).toBe(4); // participation only
  });

  it('refuses to record the implementation twice', async () => {
    await seedDecision({ status: 'CLOSED' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });
    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_rice'] },
    });
    const second = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_pasta'] },
    });

    expect(second.statusCode).toBe(409);
    // The budget was spent exactly once.
    expect((await db.kitchenBudget.findUniqueOrThrow({ where: { id: 'budget_test' } })).spentUnits).toBe(600);
  });

  it('refuses to record an implementation before the audience result is published', async () => {
    await seedDecision({ status: 'CLOSED' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_rice'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

// ---------------------------------------------------------------------------
// 8. Unauthorised admin action rejected
// ---------------------------------------------------------------------------

describe('8. authorisation', () => {
  it('refuses every operator action to an ordinary user', async () => {
    await seedDecision();
    const client = await makeUser('viewer@test.local', 'Viewer');

    for (const path of ['open', 'close', 'publish-audience-result']) {
      const response = await client.request({
        method: 'POST',
        url: `${KITCHEN}/admin/kd_test/${path}`,
      });
      expect(response.statusCode, path).toBe(403);
    }

    const implement = await client.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/implement`,
      payload: { optionIds: ['ko_rice'] },
    });
    expect(implement.statusCode).toBe(403);

    const created = await client.request({
      method: 'POST',
      url: `${KITCHEN}/admin`,
      payload: {
        budgetId: 'budget_test',
        title: 'Sneaky decision',
        question: 'Can I?',
        opensAt: new Date().toISOString(),
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        options: [
          { label: 'A', unitCost: 1 },
          { label: 'B', unitCost: 1 },
        ],
      },
    });
    expect(created.statusCode).toBe(403);

    const listed = await client.request({ method: 'GET', url: `${KITCHEN}/admin/list` });
    expect(listed.statusCode).toBe(403);
  });

  it('refuses a moderator, who has no kitchen permission', async () => {
    await seedDecision();
    const moderator = await makeUser('mod@test.local', 'Mod', 'MODERATOR');

    const response = await moderator.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/close`,
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an anonymous operator action', async () => {
    await seedDecision();
    const response = await app.inject({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/close`,
    });
    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Operator lifecycle and audit
// ---------------------------------------------------------------------------

describe('operator lifecycle', () => {
  it('creates, opens, closes, publishes and implements, writing an audit row each time', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const created = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin`,
      payload: {
        budgetId: 'budget_test',
        title: 'How much rice?',
        question: 'How much rice should be bought?',
        opensAt: new Date(Date.now() - 1000).toISOString(),
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        maxSelections: 1,
        winnerCount: 1,
        options: [
          { label: '2 kg', kind: 'QUANTITY', unitCost: 300, quantity: 2, unit: 'kg' },
          { label: '5 kg', kind: 'QUANTITY', unitCost: 750, quantity: 5, unit: 'kg' },
          { label: '8 kg', kind: 'QUANTITY', unitCost: 1200, quantity: 8, unit: 'kg' },
        ],
      },
    });

    expect(created.statusCode).toBe(201);
    const decisionId = created.json().data.id;

    // A draft is invisible to viewers.
    expect((await app.inject({ method: 'GET', url: `${KITCHEN}/${decisionId}` })).statusCode).toBe(404);

    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/${decisionId}/open` });
    expect((await app.inject({ method: 'GET', url: `${KITCHEN}/${decisionId}` })).statusCode).toBe(200);

    await producer.request({ method: 'POST', url: `${KITCHEN}/admin/${decisionId}/close` });
    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/${decisionId}/publish-audience-result`,
    });
    await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/${decisionId}/implement`,
      payload: { optionIds: [] as string[] },
    });

    const audit = await db.auditLog.findMany({ where: { entityType: 'KitchenDecision' } });
    const actions = audit.map((row) => row.action).sort();
    expect(actions).toContain('kitchen.create');
    expect(actions).toContain('kitchen.open');
    expect(actions).toContain('kitchen.close');
    expect(actions).toContain('kitchen.publish_audience');
  });

  it('refuses to open a decision whose close time has already passed', async () => {
    await seedDecision({ status: 'DRAFT', closesInMs: -1000 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/open` });
    expect(response.statusCode).toBe(400);
  });

  it('refuses to close a decision that is not open', async () => {
    await seedDecision({ status: 'CLOSED' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({ method: 'POST', url: `${KITCHEN}/admin/kd_test/close` });
    expect(response.statusCode).toBe(409);
  });

  it('refuses to publish before closing', async () => {
    await seedDecision({ status: 'OPEN' });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin/kd_test/publish-audience-result`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses a decision that would buy more options than it offers', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${KITCHEN}/admin`,
      payload: {
        budgetId: 'budget_test',
        title: 'Impossible',
        question: 'Buy three of two?',
        opensAt: new Date().toISOString(),
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        winnerCount: 3,
        options: [
          { label: 'A', unitCost: 1 },
          { label: 'B', unitCost: 1 },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('never accepts a cost from a voter', async () => {
    await seedDecision();
    const client = await makeUser('voter@test.local', 'Voter');

    // Extra fields are simply not part of the contract; the stored cost is
    // whatever production configured.
    await client.request({
      method: 'POST',
      url: `${KITCHEN}/kd_test/votes`,
      payload: { optionIds: ['ko_rice'], unitCost: 0, budget: 999_999 },
    });

    const option = await db.kitchenOption.findUniqueOrThrow({ where: { id: 'ko_rice' } });
    expect(option.unitCost).toBe(600);
    const budget = await db.kitchenBudget.findUniqueOrThrow({ where: { id: 'budget_test' } });
    expect(budget.totalUnits).toBe(5000);
    expect(budget.spentUnits).toBe(0);
  });
});
