import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { redeemReward } from '../../src/modules/rewards/rewards.service.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const REWARDS = `${API_PREFIX}/rewards`;

let app: FastifyInstance;
/** Hashing is deliberately slow; the concurrency test needs 100 users. */
let sharedHash: string;

beforeAll(async () => {
  app = await buildTestApp();
  sharedHash = await hashPassword(VALID_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await disconnectTestDatabase();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeUser(
  email: string,
  displayName: string,
  options: {
    role?: 'USER' | 'MODERATOR' | 'PRODUCER' | 'ADMIN';
    points?: number;
    login?: boolean;
  } = {},
) {
  const points = options.points ?? 1000;
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: sharedHash,
      role: options.role ?? 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: {
        create: { displayName, pointsBalance: points, lifetimePoints: points },
      },
    },
  });

  const client = new TestClient(app);
  if (options.login !== false) {
    await client.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email, password: VALID_PASSWORD },
    });
  }
  return Object.assign(client, { userId: user.id });
}

interface RewardFixture {
  code?: string;
  name?: string;
  category?: 'DIGITAL' | 'EXPERIENCE' | 'PHYSICAL';
  type?: 'DIGITAL_BADGE' | 'PROFILE_ITEM' | 'MERCH' | 'EXPERIENCE' | 'SHOUTOUT';
  pointCost?: number;
  status?: 'DRAFT' | 'AVAILABLE' | 'PAUSED' | 'RETIRED';
  totalUnits?: number | null;
  oncePerUser?: boolean;
  requiresApproval?: boolean;
  authorised?: boolean;
  rule?: {
    minLevel?: number;
    minActivities?: number;
    minDistinctFeatures?: number;
    requiredFeatures?: string[];
  };
}

async function makeReward(fixture: RewardFixture = {}) {
  const category = fixture.category ?? 'DIGITAL';
  const units = fixture.totalUnits === undefined ? 100 : fixture.totalUnits;

  return db.rewardCatalog.create({
    data: {
      code: fixture.code ?? `REWARD_${Math.round(Math.random() * 1e9).toString(36).toUpperCase()}`,
      name: fixture.name ?? 'Golden Badge',
      description: 'A badge for the dedicated viewer.',
      category,
      type: fixture.type ?? 'DIGITAL_BADGE',
      pointCost: fixture.pointCost ?? 100,
      status: fixture.status ?? 'AVAILABLE',
      oncePerUser: fixture.oncePerUser ?? true,
      requiresApproval: fixture.requiresApproval ?? category !== 'DIGITAL',
      requiresProductionApproval: category !== 'DIGITAL',
      ...(fixture.authorised ? { authorisedAt: new Date() } : {}),
      inventory: { create: { totalUnits: units, remaining: units } },
      ...(fixture.rule
        ? {
            rule: {
              create: {
                minLevel: fixture.rule.minLevel ?? 0,
                minActivities: fixture.rule.minActivities ?? 0,
                minDistinctFeatures: fixture.rule.minDistinctFeatures ?? 0,
                requiredFeatures: fixture.rule.requiredFeatures ?? [],
              },
            },
          }
        : {}),
    },
    include: { inventory: true },
  });
}

function inventoryOf(rewardId: string) {
  return db.rewardInventory.findUniqueOrThrow({ where: { rewardId } });
}

beforeEach(async () => {
  await resetAll();
});

// ---------------------------------------------------------------------------
// 1. User sees available rewards
// ---------------------------------------------------------------------------

describe('browsing the catalogue', () => {
  it('shows published rewards with their cost and the user’s eligibility', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 250 });
    await makeReward({ code: 'BADGE_GOLD', name: 'Golden Badge', pointCost: 100 });
    await makeReward({ code: 'FRAME_NEON', name: 'Neon Frame', pointCost: 400 });

    const response = await viewer.request({ method: 'GET', url: REWARDS });
    expect(response.statusCode).toBe(200);

    const rewards = response.json().data as {
      code: string;
      pointCost: number;
      eligibility: { eligible: boolean; affordable: boolean };
    }[];
    expect(rewards.map((reward) => reward.code)).toEqual(['BADGE_GOLD', 'FRAME_NEON']);

    // Both are earned; only one is affordable on 250 points.
    expect(rewards[0]).toMatchObject({ eligibility: { eligible: true, affordable: true } });
    expect(rewards[1]).toMatchObject({ eligibility: { eligible: true, affordable: false } });
  });

  it('hides drafts, paused, retired and unauthorised rewards', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer');
    await makeReward({ code: 'VISIBLE', status: 'AVAILABLE' });
    await makeReward({ code: 'DRAFT_ONE', status: 'DRAFT' });
    await makeReward({ code: 'PAUSED_ONE', status: 'PAUSED' });
    await makeReward({ code: 'RETIRED_ONE', status: 'RETIRED' });
    // Published by a database write but never authorised — still invisible.
    await makeReward({ code: 'PHYSICAL_UNAUTH', category: 'PHYSICAL', status: 'AVAILABLE' });

    const response = await viewer.request({ method: 'GET', url: REWARDS });
    const codes = (response.json().data as { code: string }[]).map((reward) => reward.code);
    expect(codes).toEqual(['VISIBLE']);
  });

  it('serves the catalogue to a signed-out visitor without eligibility', async () => {
    await makeReward({ code: 'BADGE_GOLD' });
    const response = await app.inject({ method: 'GET', url: REWARDS });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ code: 'BADGE_GOLD', eligibility: null });
  });

  it('explains exactly which requirement is unmet', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 100 });
    await makeReward({ code: 'ELITE', rule: { minDistinctFeatures: 3 } });

    const response = await viewer.request({ method: 'GET', url: REWARDS });
    const [reward] = response.json().data as {
      eligibility: {
        eligible: boolean;
        requirements: { key: string; met: boolean; current: number; required: number }[];
      };
    }[];

    expect(reward!.eligibility.eligible).toBe(false);
    expect(reward!.eligibility.requirements).toContainEqual(
      expect.objectContaining({ key: 'distinctFeatures', met: false, current: 0, required: 3 }),
    );
  });
});

// ---------------------------------------------------------------------------
// 2 & 7. Redeeming, and the ledger entry it writes
// ---------------------------------------------------------------------------

describe('redeeming a reward', () => {
  it('grants a digital reward immediately and debits through the ledger', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const reward = await makeReward({ code: 'BADGE_GOLD', pointCost: 120 });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(201);

    const body = response.json().data as {
      redemption: { id: string; status: string; pointsSpent: number };
      balance: number;
    };
    expect(body.redemption.status).toBe('FULFILLED');
    expect(body.redemption.pointsSpent).toBe(120);
    expect(body.balance).toBe(380);

    // The balance moved because a ledger row moved it — not the other way round.
    const entries = await db.pointsLedger.findMany({ where: { userId: viewer.userId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      delta: -120,
      entryType: 'SPEND',
      sourceType: 'REWARD_REDEMPTION',
      sourceId: reward.id,
      balanceAfter: 380,
    });

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(380);
    // Spending must never cost you a level.
    expect(profile.lifetimePoints).toBe(500);

    const redemption = await db.rewardRedemption.findUniqueOrThrow({
      where: { id: body.redemption.id },
    });
    expect(redemption.ledgerEntryId).toBe(entries[0]!.id);

    const inventory = await inventoryOf(reward.id);
    expect(inventory).toMatchObject({ remaining: 99, reserved: 0, fulfilled: 1 });
  });

  it('records every lifecycle step', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer');
    const reward = await makeReward({ pointCost: 50 });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });

    const history = (response.json().data.redemption.history as { toStatus: string }[]).map(
      (event) => event.toStatus,
    );
    expect(history).toEqual(['REQUESTED', 'RESERVED', 'APPROVED', 'FULFILLED']);
  });

  it('holds a reward that needs approval at RESERVED', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer');
    const reward = await makeReward({ pointCost: 50, requiresApproval: true });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.json().data.redemption.status).toBe('RESERVED');

    // Points leave straight away; the unit stays reserved rather than fulfilled.
    const inventory = await inventoryOf(reward.id);
    expect(inventory).toMatchObject({ remaining: 99, reserved: 1, fulfilled: 0 });
  });

  it('grants a free reward without writing a ledger row', async () => {
    // Earned badges cost nothing. A zero-point ledger entry would record a
    // movement that never happened.
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const reward = await makeReward({ code: 'BADGE_FREE', pointCost: 0 });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ pointsSpent: 0, balance: 500 });
    expect(response.json().data.redemption.status).toBe('FULFILLED');

    expect(await db.pointsLedger.count()).toBe(0);
    expect(await inventoryOf(reward.id)).toMatchObject({ remaining: 99, fulfilled: 1 });
  });

  it('refuses a reward the user has not earned', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 10_000 });
    const reward = await makeReward({ pointCost: 10, rule: { minActivities: 5 } });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NOT_ELIGIBLE');
    expect(await db.pointsLedger.count()).toBe(0);
  });

  it('rejects an anonymous redemption', async () => {
    const reward = await makeReward();
    const response = await app.inject({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3. Insufficient points
// ---------------------------------------------------------------------------

describe('insufficient points', () => {
  it('refuses the redemption and moves nothing', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 50 });
    const reward = await makeReward({ pointCost: 500 });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INSUFFICIENT_POINTS');

    // The rollback is the point: no ledger row, no redemption, no unit taken.
    expect(await db.pointsLedger.count()).toBe(0);
    expect(await db.rewardRedemption.count()).toBe(0);
    expect(await inventoryOf(reward.id)).toMatchObject({ remaining: 100, reserved: 0 });

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(50);
  });

  it('never lets a balance go negative, even at exactly the cost', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 100 });
    const reward = await makeReward({ pointCost: 100 });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Inventory exhaustion
// ---------------------------------------------------------------------------

describe('inventory', () => {
  it('turns the last unit away without charging them', async () => {
    const first = await makeUser('first@test.local', 'First');
    const second = await makeUser('second@test.local', 'Second');
    const reward = await makeReward({ pointCost: 100, totalUnits: 1 });

    const win = await first.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    expect(win.statusCode).toBe(201);

    const lose = await second.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    expect(lose.statusCode).toBe(409);
    expect(lose.json().error.code).toBe('REWARD_UNAVAILABLE');

    expect(await inventoryOf(reward.id)).toMatchObject({ remaining: 0, fulfilled: 1 });
    expect(await db.pointsLedger.count({ where: { userId: second.userId } })).toBe(0);
  });

  it('treats a null total as unlimited', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer');
    const reward = await makeReward({ pointCost: 10, totalUnits: null });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(201);
    // NULL - 1 is still NULL: unlimited stock never depletes.
    expect((await inventoryOf(reward.id)).remaining).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicate redemption
// ---------------------------------------------------------------------------

describe('duplicate redemption', () => {
  it('blocks a second claim of a once-per-user reward', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 1000 });
    const reward = await makeReward({ pointCost: 100, oncePerUser: true });

    const first = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    expect(first.statusCode).toBe(201);

    const second = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ALREADY_CLAIMED');

    // Charged once, and the failed attempt returned the unit it briefly held.
    expect(await db.pointsLedger.count({ where: { userId: viewer.userId } })).toBe(1);
    expect(await inventoryOf(reward.id)).toMatchObject({ remaining: 99, reserved: 0, fulfilled: 1 });
  });

  it('marks a held reward so the UI can grey it out', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer');
    const reward = await makeReward({ pointCost: 100 });
    await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });

    const response = await viewer.request({ method: 'GET', url: `${REWARDS}/${reward.id}` });
    expect(response.json().data.eligibility.alreadyHeld).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Concurrency — the scenario from the brief
// ---------------------------------------------------------------------------

describe('concurrent redemption', () => {
  it('gives exactly 10 of 10 units to 100 simultaneous redeemers', async () => {
    const reward = await makeReward({ code: 'SCARCE', pointCost: 100, totalUnits: 10 });

    // 100 users, each able to afford exactly one.
    const users = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        db.user.create({
          data: {
            email: `rush${index}@test.local`,
            emailNormalized: `rush${index}@test.local`,
            passwordHash: sharedHash,
            role: 'USER',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            profile: {
              create: { displayName: `Rusher ${index}`, pointsBalance: 100, lifetimePoints: 100 },
            },
          },
          select: { id: true },
        }),
      ),
    );

    const results = await Promise.allSettled(
      users.map((user) => redeemReward(reward.id, user.id)),
    );

    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');

    expect(won).toHaveLength(10);
    expect(lost).toHaveLength(90);

    // Every loser was turned away for the right reason, not by a crash.
    for (const failure of lost) {
      expect((failure as PromiseRejectedResult).reason).toMatchObject({
        code: 'REWARD_UNAVAILABLE',
      });
    }

    // No negative inventory, and no unit left dangling in `reserved`.
    const inventory = await inventoryOf(reward.id);
    expect(inventory.remaining).toBe(0);
    expect(inventory.reserved).toBe(0);
    expect(inventory.fulfilled).toBe(10);
    expect(inventory.remaining! + inventory.reserved + inventory.fulfilled).toBe(
      inventory.totalUnits,
    );

    // Exactly ten redemptions, ten debits, and not a point more.
    expect(await db.rewardRedemption.count()).toBe(10);
    const ledger = await db.pointsLedger.findMany({ where: { sourceId: reward.id } });
    expect(ledger).toHaveLength(10);
    expect(ledger.every((entry) => entry.delta === -100)).toBe(true);

    // Nobody was double-charged, and nobody's balance went below zero.
    const profiles = await db.userProfile.findMany({ select: { pointsBalance: true } });
    expect(profiles.filter((profile) => profile.pointsBalance === 0)).toHaveLength(10);
    expect(profiles.filter((profile) => profile.pointsBalance === 100)).toHaveLength(90);
    expect(profiles.some((profile) => profile.pointsBalance < 0)).toBe(false);
  }, 60_000);

  it('charges a double-tapping user exactly once', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 1000, login: false });
    const reward = await makeReward({ pointCost: 100, totalUnits: 50 });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => redeemReward(reward.id, viewer.userId)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.pointsLedger.count({ where: { userId: viewer.userId } })).toBe(1);
    expect(await inventoryOf(reward.id)).toMatchObject({ remaining: 49, reserved: 0, fulfilled: 1 });
  }, 30_000);

  it('cannot be overdrawn by simultaneous spends on different rewards', async () => {
    // 100 points, two rewards costing 100 each: one must lose.
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 100, login: false });
    const first = await makeReward({ code: 'ONE', pointCost: 100 });
    const second = await makeReward({ code: 'TWO', pointCost: 100 });

    const results = await Promise.allSettled([
      redeemReward(first.id, viewer.userId),
      redeemReward(second.id, viewer.userId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(0);

    // The loser's reservation was rolled back, not left orphaned.
    const inventories = await db.rewardInventory.findMany();
    const taken = inventories.reduce((sum, row) => sum + row.reserved + row.fulfilled, 0);
    expect(taken).toBe(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 8. Cancellation and refunds
// ---------------------------------------------------------------------------

describe('cancellation and refunds', () => {
  it('refunds a reserved redemption with a compensating ledger row', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const reward = await makeReward({ pointCost: 200, requiresApproval: true });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const redemptionId = redeem.json().data.redemption.id as string;

    const cancel = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/me/redemptions/${redemptionId}/cancel`,
      payload: { note: 'Changed my mind' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data).toMatchObject({ status: 'CANCELLED', refunded: true });

    // Two rows, not an edited one: the debit stays, the refund compensates it.
    const ledger = await db.pointsLedger.findMany({
      where: { userId: viewer.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger.map((entry) => [entry.entryType, entry.delta])).toEqual([
      ['SPEND', -200],
      ['REVERSAL', 200],
    ]);

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(500);
    // A refund is not an achievement — it must not inflate lifetime points.
    expect(profile.lifetimePoints).toBe(500);

    expect(await inventoryOf(reward.id)).toMatchObject({ remaining: 100, reserved: 0 });
  });

  it('lets the user redeem again after cancelling', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const reward = await makeReward({ pointCost: 100, requiresApproval: true });

    const first = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    await viewer.request({
      method: 'POST',
      url: `${REWARDS}/me/redemptions/${first.json().data.redemption.id}/cancel`,
      payload: {},
    });

    const second = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    expect(second.statusCode).toBe(201);
  });

  it('refuses to cancel a reward that has already been given', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const reward = await makeReward({ pointCost: 100 });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const cancel = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/me/redemptions/${redeem.json().data.redemption.id}/cancel`,
      payload: {},
    });

    expect(cancel.statusCode).toBe(409);
    // No sneaky clawback of the points that bought a delivered reward.
    expect(await db.pointsLedger.count({ where: { userId: viewer.userId } })).toBe(1);
  });

  it('refuses to cancel somebody else’s redemption', async () => {
    const owner = await makeUser('owner@test.local', 'Owner');
    const stranger = await makeUser('stranger@test.local', 'Stranger');
    const reward = await makeReward({ pointCost: 100, requiresApproval: true });

    const redeem = await owner.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const cancel = await stranger.request({
      method: 'POST',
      url: `${REWARDS}/me/redemptions/${redeem.json().data.redemption.id}/cancel`,
      payload: {},
    });
    expect(cancel.statusCode).toBe(403);
  });

  it('refunds when a producer rejects a redemption', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const reward = await makeReward({ pointCost: 200, requiresApproval: true });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const redemptionId = redeem.json().data.redemption.id as string;

    const reject = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${redemptionId}/reject`,
      payload: { reason: 'Out of stock at the supplier' },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().data).toMatchObject({ status: 'REJECTED', refunded: true });

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(500);
  });

  it('does not refund twice when fulfilment completes', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const reward = await makeReward({ pointCost: 200, requiresApproval: true });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const id = redeem.json().data.redemption.id as string;

    await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${id}/approve`,
      payload: {},
    });
    const fulfil = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${id}/fulfil`,
      payload: {},
    });
    expect(fulfil.json().data).toMatchObject({ status: 'FULFILLED', refunded: false });

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(300);
    expect(await inventoryOf(reward.id)).toMatchObject({ reserved: 0, fulfilled: 1 });
  });

  it('refuses an invalid lifecycle jump', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const reward = await makeReward({ pointCost: 100, requiresApproval: true });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const id = redeem.json().data.redemption.id as string;

    // RESERVED cannot jump straight to FULFILLED — approval is not optional.
    const fulfil = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${id}/fulfil`,
      payload: {},
    });
    expect(fulfil.statusCode).toBe(409);
    expect(fulfil.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

// ---------------------------------------------------------------------------
// 9. Authorisation
// ---------------------------------------------------------------------------

describe('administration permissions', () => {
  it('lets a moderator look but not touch', async () => {
    const moderator = await makeUser('mod@test.local', 'Mod', { role: 'MODERATOR' });
    await makeReward({ code: 'BADGE_GOLD' });

    const read = await moderator.request({ method: 'GET', url: `${REWARDS}/admin/catalogue` });
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toHaveLength(1);

    const write = await moderator.request({
      method: 'POST',
      url: `${REWARDS}/admin`,
      payload: {
        code: 'NEW_BADGE',
        name: 'New Badge',
        category: 'DIGITAL',
        type: 'DIGITAL_BADGE',
        pointCost: 10,
      },
    });
    expect(write.statusCode).toBe(403);
    expect(await db.rewardCatalog.count()).toBe(1);
  });

  it('refuses an ordinary user entirely', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer');
    const reward = await makeReward();

    for (const url of [
      `${REWARDS}/admin/catalogue`,
      `${REWARDS}/admin/redemptions`,
    ]) {
      expect((await viewer.request({ method: 'GET', url })).statusCode).toBe(403);
    }

    const retire = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${reward.id}/retire`,
      payload: {},
    });
    expect(retire.statusCode).toBe(403);
    expect((await db.rewardCatalog.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe(
      'AVAILABLE',
    );
  });

  it('lets a producer run the catalogue', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });

    const create = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin`,
      payload: {
        code: 'BADGE_NEW',
        name: 'Brand New Badge',
        category: 'DIGITAL',
        type: 'DIGITAL_BADGE',
        pointCost: 250,
        totalUnits: 25,
      },
    });
    expect(create.statusCode).toBe(201);
    const rewardId = create.json().data.id as string;
    // Nothing is published on creation.
    expect(create.json().data.status).toBe('DRAFT');

    const publish = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${rewardId}/status`,
      payload: { status: 'AVAILABLE' },
    });
    expect(publish.statusCode).toBe(200);

    const stock = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${rewardId}/inventory`,
      payload: { units: 15 },
    });
    expect(stock.statusCode).toBe(200);
    expect(await inventoryOf(rewardId)).toMatchObject({ totalUnits: 40, remaining: 40 });
  });

  it('reserves retiring and force-cancelling for an admin', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const admin = await makeUser('admin@test.local', 'Admin', { role: 'ADMIN' });
    const reward = await makeReward({ pointCost: 100, requiresApproval: true });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    const redemptionId = redeem.json().data.redemption.id as string;

    const producerCancel = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${redemptionId}/cancel`,
      payload: {},
    });
    expect(producerCancel.statusCode).toBe(403);

    const producerRetire = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${reward.id}/retire`,
      payload: {},
    });
    expect(producerRetire.statusCode).toBe(403);

    const adminCancel = await admin.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${redemptionId}/cancel`,
      payload: { note: 'Withdrawn by production' },
    });
    expect(adminCancel.statusCode).toBe(200);
    // Taking it back returns the points.
    expect(adminCancel.json().data.refunded).toBe(true);

    const adminRetire = await admin.request({
      method: 'POST',
      url: `${REWARDS}/admin/${reward.id}/retire`,
      payload: {},
    });
    expect(adminRetire.statusCode).toBe(200);
    expect(adminRetire.json().data.status).toBe('RETIRED');
  });

  it('writes an audit entry for every sensitive action', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 500 });
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const reward = await makeReward({ pointCost: 100, requiresApproval: true });

    const redeem = await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/redemptions/${redeem.json().data.redemption.id}/approve`,
      payload: {},
    });

    const actions = (await db.auditLog.findMany({ select: { action: true } })).map(
      (row) => row.action,
    );
    expect(actions).toContain('reward.redeem');
    expect(actions).toContain('reward.approve');
  });
});

// ---------------------------------------------------------------------------
// 10. Physical and experience rewards
// ---------------------------------------------------------------------------

describe('physical and experience rewards', () => {
  it('cannot be published without production authorisation', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });

    const create = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin`,
      payload: {
        code: 'MERCH_HOODIE',
        name: 'Show Hoodie',
        category: 'PHYSICAL',
        type: 'MERCH',
        pointCost: 5000,
        totalUnits: 20,
      },
    });
    expect(create.statusCode).toBe(201);
    const rewardId = create.json().data.id as string;
    expect(create.json().data).toMatchObject({
      status: 'DRAFT',
      requiresProductionApproval: true,
      authorised: false,
    });

    const publish = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${rewardId}/status`,
      payload: { status: 'AVAILABLE' },
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.json().error.code).toBe('NOT_AUTHORISED');
  });

  it('demands an explicit acknowledgement and a disclaimer to authorise', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const reward = await makeReward({
      code: 'MERCH_TEE',
      category: 'PHYSICAL',
      type: 'MERCH',
      status: 'DRAFT',
    });

    // A bare yes is not enough.
    const bare = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${reward.id}/authorise`,
      payload: { authorised: true },
    });
    expect(bare.statusCode).toBe(400);

    // Neither is an acknowledgement with no disclaimer.
    const noDisclaimer = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${reward.id}/authorise`,
      payload: { authorised: true, acknowledgeProductionAuthorisation: true },
    });
    expect(noDisclaimer.statusCode).toBe(400);

    expect((await db.rewardCatalog.findUniqueOrThrow({ where: { id: reward.id } })).authorisedAt)
      .toBeNull();

    const full = await producer.request({
      method: 'POST',
      url: `${REWARDS}/admin/${reward.id}/authorise`,
      payload: {
        authorised: true,
        acknowledgeProductionAuthorisation: true,
        disclaimer: 'Production has confirmed stock and will arrange postage directly.',
      },
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().data.authorised).toBe(true);

    const stored = await db.rewardCatalog.findUniqueOrThrow({ where: { id: reward.id } });
    expect(stored.authorisedById).toBe(producer.userId);
  });

  it('refuses redemption of an unauthorised physical reward', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 10_000 });
    // Forced to AVAILABLE in the database — authorisation is still missing.
    const reward = await makeReward({
      category: 'PHYSICAL',
      type: 'MERCH',
      status: 'AVAILABLE',
      pointCost: 100,
    });

    const response = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/not been authorised/i);
    expect(await db.pointsLedger.count()).toBe(0);
  });

  it('always carries a disclaimer, and never auto-fulfils', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 10_000 });
    const reward = await makeReward({
      category: 'EXPERIENCE',
      type: 'EXPERIENCE',
      status: 'AVAILABLE',
      authorised: true,
      pointCost: 500,
    });

    const detail = await viewer.request({ method: 'GET', url: `${REWARDS}/${reward.id}` });
    expect(detail.json().data.disclaimer).toMatch(/production/i);

    const redeem = await viewer.request({
      method: 'POST',
      url: `${REWARDS}/${reward.id}/redeem`,
    });
    expect(redeem.statusCode).toBe(201);
    // A real-world promise waits for a human, whatever the reward config says.
    expect(redeem.json().data.redemption.status).toBe('RESERVED');
    expect(redeem.json().data.redemption.reward.disclaimer).toMatch(/production/i);
  });

  it('drops authorisation if the category is changed underneath it', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const reward = await makeReward({
      category: 'DIGITAL',
      status: 'DRAFT',
      pointCost: 100,
    });

    const change = await producer.request({
      method: 'PATCH',
      url: `${REWARDS}/admin/${reward.id}`,
      payload: { category: 'PHYSICAL', type: 'MERCH' },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().data).toMatchObject({
      requiresProductionApproval: true,
      authorised: false,
    });
  });
});

// ---------------------------------------------------------------------------
// My rewards
// ---------------------------------------------------------------------------

describe('my rewards', () => {
  it('lists a user’s own redemptions and nobody else’s', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 1000 });
    const other = await makeUser('other@test.local', 'Other', { points: 1000 });
    const reward = await makeReward({ pointCost: 100 });

    await viewer.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });
    await other.request({ method: 'POST', url: `${REWARDS}/${reward.id}/redeem` });

    const mine = await viewer.request({ method: 'GET', url: `${REWARDS}/me/redemptions` });
    expect(mine.json().data).toHaveLength(1);
    expect(mine.json().data[0].reward.id).toBe(reward.id);
  });

  it('reports the user’s level and progress', async () => {
    const viewer = await makeUser('viewer@test.local', 'Viewer', { points: 350 });
    const response = await viewer.request({ method: 'GET', url: `${REWARDS}/me/level` });
    expect(response.json().data).toMatchObject({
      level: 3,
      lifetimePoints: 350,
      pointsIntoLevel: 50,
      pointsForNextLevel: 350,
    });
  });
});
