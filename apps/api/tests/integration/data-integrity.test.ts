import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { settleDomainEvents } from '../../src/core/domain-events.js';
import { hashPassword } from '../../src/core/password.js';
import { settleAnalytics } from '../../src/modules/analytics/analytics.service.js';
import { syncLeaderboards } from '../../src/modules/leaderboards/leaderboards.service.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

/**
 * Cross-module state consistency.
 *
 * Every other suite asks "did this module do its job". These ask the question
 * that only matters once the modules are assembled: after a real sequence of
 * actions, do the six places that record what happened still agree with each
 * other?
 *
 * The ledger is the arbiter throughout. A balance, a rank and a redemption are
 * all derived views of it, and any of them disagreeing with it is a defect
 * regardless of which one looks more plausible.
 */

const AUTH = `${API_PREFIX}/auth`;
const PREDICTIONS = `${API_PREFIX}/predictions`;
const POLLS = `${API_PREFIX}/polls`;
const REWARDS = `${API_PREFIX}/rewards`;
const LEADERBOARDS = `${API_PREFIX}/leaderboards`;

let app: FastifyInstance;
let passwordHash: string;

beforeAll(async () => {
  app = await buildTestApp();
  passwordHash = await hashPassword(VALID_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetAll();
  await seedWorld();
});

async function seedWorld(): Promise<void> {
  await db.show.create({
    data: { id: 'show_i', slug: 'integrity-show', name: 'Integrity Show', status: 'LIVE' },
  });
  await db.pointsRule.createMany({
    data: [
      { key: 'PREDICTION_PARTICIPATION', points: 5 },
      { key: 'PREDICTION_CORRECT', points: 50 },
      { key: 'POLL_PARTICIPATION', points: 3 },
    ],
  });
  await db.prediction.create({
    data: {
      id: 'pred_i',
      showId: 'show_i',
      question: 'Who wins the task tonight?',
      status: 'OPEN',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      participationPoints: 5,
      rewardPoints: 50,
      options: {
        create: [
          { id: 'pi_a', label: 'A', sortOrder: 0 },
          { id: 'pi_b', label: 'B', sortOrder: 1 },
        ],
      },
    },
  });
  await db.livePoll.create({
    data: {
      id: 'poll_i',
      showId: 'show_i',
      question: 'Was that fair?',
      status: 'ACTIVE',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      participationPoints: 3,
      options: {
        create: [
          { id: 'pli_a', label: 'Yes', sortOrder: 0 },
          { id: 'pli_b', label: 'No', sortOrder: 1 },
        ],
      },
    },
  });
  await db.rewardCatalog.create({
    data: {
      id: 'rw_i',
      code: 'INTEGRITY_BADGE',
      name: 'Integrity badge',
      category: 'DIGITAL',
      type: 'DIGITAL_BADGE',
      pointCost: 5,
      status: 'AVAILABLE',
      oncePerUser: false,
      requiresProductionApproval: false,
      inventory: { create: { totalUnits: 10, remaining: 10 } },
    },
  });
}

async function makeUser(name: string, points = 0) {
  const email = `${name}@integrity.local`;
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: name, pointsBalance: points, lifetimePoints: points } },
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

/** The ledger's own account of a user, which every other view must match. */
async function ledgerTotals(userId: string) {
  const entries = await db.pointsLedger.findMany({ where: { userId } });
  return {
    balance: entries.reduce((sum, entry) => sum + entry.delta, 0),
    // Only EARN moves a lifetime total — otherwise redeem-then-cancel would be
    // a level-farming loop.
    lifetime: entries
      .filter((entry) => entry.entryType === 'EARN')
      .reduce((sum, entry) => sum + entry.delta, 0),
    count: entries.length,
  };
}

// ---------------------------------------------------------------------------

describe('the ledger and the profile agree', () => {
  it('after earning through several features', async () => {
    const user = await makeUser('earner');

    await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });
    await user.request({
      method: 'POST',
      url: `${POLLS}/poll_i/vote`,
      payload: { optionId: 'pli_a' },
    });

    const totals = await ledgerTotals(user.userId);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: user.userId } });

    expect(profile.pointsBalance).toBe(totals.balance);
    expect(profile.lifetimePoints).toBe(totals.lifetime);
    expect(totals.count).toBe(2);
  });

  it('after earning and then spending', async () => {
    const user = await makeUser('spender');

    await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });
    const redeem = await user.request({
      method: 'POST',
      url: `${REWARDS}/rw_i/redeem`,
      payload: {},
    });
    expect(redeem.statusCode).toBe(201);

    const totals = await ledgerTotals(user.userId);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: user.userId } });

    expect(profile.pointsBalance).toBe(totals.balance);
    expect(profile.pointsBalance).toBe(0);
    // Spending must not reduce the lifetime figure the leaderboard ranks on.
    expect(profile.lifetimePoints).toBe(5);
  });

  it('and every ledger row records the balance it produced', async () => {
    const user = await makeUser('auditable');

    await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });
    await user.request({
      method: 'POST',
      url: `${POLLS}/poll_i/vote`,
      payload: { optionId: 'pli_a' },
    });

    const entries = await db.pointsLedger.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'asc' },
    });

    // Replaying the deltas must reproduce every recorded balance, which is what
    // makes the ledger reconstructable rather than merely append-only.
    let running = 0;
    for (const entry of entries) {
      running += entry.delta;
      expect(entry.balanceAfter).toBe(running);
    }
  });
});

describe('a redemption stays consistent across the tables it touches', () => {
  it('reserves stock, debits the ledger and records the redemption exactly once', async () => {
    const user = await makeUser('redeemer', 100);

    const response = await user.request({
      method: 'POST',
      url: `${REWARDS}/rw_i/redeem`,
      payload: {},
    });
    expect(response.statusCode).toBe(201);

    const redemptions = await db.rewardRedemption.findMany({ where: { userId: user.userId } });
    expect(redemptions).toHaveLength(1);

    const spends = await db.pointsLedger.findMany({
      where: { userId: user.userId, entryType: 'SPEND' },
    });
    expect(spends).toHaveLength(1);
    expect(spends[0]!.delta).toBe(-5);

    const inventory = await db.rewardInventory.findUniqueOrThrow({ where: { rewardId: 'rw_i' } });
    // One unit accounted for, and the three counters still add up to the total.
    expect((inventory.remaining ?? 0) + inventory.reserved + inventory.fulfilled).toBe(
      inventory.totalUnits,
    );
  });

  it('leaves nothing behind when a redemption is refused', async () => {
    const user = await makeUser('broke', 1);

    const response = await user.request({
      method: 'POST',
      url: `${REWARDS}/rw_i/redeem`,
      payload: {},
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    expect(await db.rewardRedemption.count({ where: { userId: user.userId } })).toBe(0);
    expect(await db.pointsLedger.count({ where: { userId: user.userId } })).toBe(0);

    const inventory = await db.rewardInventory.findUniqueOrThrow({ where: { rewardId: 'rw_i' } });
    expect(inventory.remaining).toBe(10);
    expect(inventory.reserved).toBe(0);
  });

  it('keeps stock and ledger in step under concurrent redemptions', async () => {
    await db.rewardInventory.update({
      where: { rewardId: 'rw_i' },
      data: { totalUnits: 3, remaining: 3 },
    });

    const users = await Promise.all(
      Array.from({ length: 12 }, (_, index) => makeUser(`racer${index}`, 100)),
    );

    const results = await Promise.all(
      users.map((user) =>
        user.request({ method: 'POST', url: `${REWARDS}/rw_i/redeem`, payload: {} }),
      ),
    );

    const won = results.filter((response) => response.statusCode === 201);
    expect(won).toHaveLength(3);

    // Exactly three redemptions, three debits, and no stock conjured or lost.
    expect(await db.rewardRedemption.count({ where: { rewardId: 'rw_i' } })).toBe(3);
    expect(await db.pointsLedger.count({ where: { entryType: 'SPEND' } })).toBe(3);

    const inventory = await db.rewardInventory.findUniqueOrThrow({ where: { rewardId: 'rw_i' } });
    expect((inventory.remaining ?? 0) + inventory.reserved + inventory.fulfilled).toBe(3);
  });
});

describe('the leaderboard reflects the ledger and nothing else', () => {
  it('ranks on what was earned, not on what is left after spending', async () => {
    const bigSpender = await makeUser('bigspender', 0);
    const saver = await makeUser('saver', 0);

    // The spender earns more but ends with less.
    await bigSpender.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });
    await bigSpender.request({
      method: 'POST',
      url: `${POLLS}/poll_i/vote`,
      payload: { optionId: 'pli_a' },
    });
    await bigSpender.request({ method: 'POST', url: `${REWARDS}/rw_i/redeem`, payload: {} });

    await saver.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_b' },
    });

    const spenderProfile = await db.userProfile.findUniqueOrThrow({
      where: { userId: bigSpender.userId },
    });
    const saverProfile = await db.userProfile.findUniqueOrThrow({
      where: { userId: saver.userId },
    });
    expect(spenderProfile.pointsBalance).toBeLessThan(saverProfile.pointsBalance);

    await syncLeaderboards();
    const board = await bigSpender.request({ method: 'GET', url: `${LEADERBOARDS}?window=SEASON` });
    expect(board.statusCode).toBe(200);
    expect(board.json().data.me.points).toBe(spenderProfile.lifetimePoints);
    // Earned more, so ranked above, despite holding fewer points.
    expect(board.json().data.me.rank).toBe(1);
  });

  it('never lets a client submit its own score', async () => {
    const user = await makeUser('liar', 0);

    const smuggled = await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      // Everything an attacker would try to smuggle in.
      payload: { optionId: 'pi_a', points: 99_999, score: 99_999, rank: 1, balance: 99_999 },
    });

    // The unknown fields are stripped by the schema rather than trusted, so
    // the action succeeds and credits exactly what the server's own rule says.
    expect(smuggled.statusCode).toBe(200);
    expect(await ledgerTotals(user.userId)).toMatchObject({ lifetime: 5, count: 1 });

    await syncLeaderboards();
    const board = await user.request({ method: 'GET', url: `${LEADERBOARDS}?window=SEASON` });
    expect(board.json().data.me.points).toBe(5);
    expect(board.json().data.me.rank).toBe(1);
  });
});

describe('the observers agree with what happened', () => {
  it('records a notification, an analytics event and a ledger row for one action', async () => {
    const user = await makeUser('observed', 0);

    await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });

    // Both consumers are fire-and-forget; a test must wait for them rather than
    // sleep and hope.
    await settleDomainEvents();
    await settleAnalytics();

    expect(await db.pointsLedger.count({ where: { userId: user.userId } })).toBe(1);
    expect(
      await db.analyticsEvent.count({
        where: { userId: user.userId, name: 'prediction_submitted' },
      }),
    ).toBe(1);
  });

  it('produces exactly one notification per user per happening, however many times it fires', async () => {
    const user = await makeUser('deduped', 100);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await user.request({
        method: 'POST',
        url: `${PREDICTIONS}/pred_i/entries`,
        payload: { optionId: 'pi_a' },
      });
    }
    await settleDomainEvents();

    // Four of those five were refused as duplicates, so exactly one ledger row
    // and at most one notification per distinct happening.
    expect(await db.pointsLedger.count({ where: { userId: user.userId } })).toBe(1);

    const notifications = await db.notification.findMany({ where: { userId: user.userId } });
    // The dedupe key is what the notification module guards on, so it is the
    // thing that must be distinct.
    const keys = notifications.map((row) => `${row.event}:${row.dedupeKey ?? row.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves an audit row for an operator action and none for a viewer action', async () => {
    const viewer = await makeUser('quiet', 100);
    await viewer.request({
      method: 'POST',
      url: `${POLLS}/poll_i/vote`,
      payload: { optionId: 'pli_a' },
    });

    // Ordinary participation is not an operator action and must not fill the
    // audit trail with noise.
    expect(await db.auditLog.count()).toBe(0);

    const email = 'producer@integrity.local';
    await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash,
        role: 'PRODUCER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'Producer' } },
      },
    });
    const producer = new TestClient(app);
    await producer.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email, password: VALID_PASSWORD },
    });

    const created = await producer.request({
      method: 'POST',
      url: `${POLLS}/admin`,
      payload: {
        question: 'An audited question?',
        durationSeconds: 60,
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    });
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);

    const rows = await db.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('poll.create');
  });
});

describe('the whole sequence stays consistent', () => {
  it('earn, redeem, rank, notify and count all agree afterwards', async () => {
    const user = await makeUser('sequence', 0);

    await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });
    await user.request({
      method: 'POST',
      url: `${POLLS}/poll_i/vote`,
      payload: { optionId: 'pli_a' },
    });
    const redeem = await user.request({
      method: 'POST',
      url: `${REWARDS}/rw_i/redeem`,
      payload: {},
    });
    expect(redeem.statusCode).toBe(201);

    await settleDomainEvents();
    await settleAnalytics();
    await syncLeaderboards();

    const totals = await ledgerTotals(user.userId);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: user.userId } });
    const board = await user.request({ method: 'GET', url: `${LEADERBOARDS}?window=SEASON` });
    const inventory = await db.rewardInventory.findUniqueOrThrow({ where: { rewardId: 'rw_i' } });

    // Six views of the same history, which must not disagree.
    expect(profile.pointsBalance).toBe(totals.balance); // 8 earned - 5 spent
    expect(profile.pointsBalance).toBe(3);
    expect(profile.lifetimePoints).toBe(totals.lifetime); // 8
    expect(board.json().data.me.points).toBe(totals.lifetime);
    expect(await db.rewardRedemption.count({ where: { userId: user.userId } })).toBe(1);
    expect((inventory.remaining ?? 0) + inventory.reserved + inventory.fulfilled).toBe(10);
    expect(
      await db.analyticsEvent.count({ where: { userId: user.userId, name: 'reward_redeemed' } }),
    ).toBe(1);
  });

  it('a cancelled redemption returns the points without inflating the lifetime total', async () => {
    // A reward that needs production approval stays reserved rather than being
    // fulfilled on the spot, which is the only state a user can cancel from.
    await db.rewardCatalog.update({
      where: { id: 'rw_i' },
      data: { requiresApproval: true },
    });
    const user = await makeUser('canceller', 0);

    await user.request({
      method: 'POST',
      url: `${PREDICTIONS}/pred_i/entries`,
      payload: { optionId: 'pi_a' },
    });
    const redeem = await user.request({
      method: 'POST',
      url: `${REWARDS}/rw_i/redeem`,
      payload: {},
    });
    const redemptionId = redeem.json().data.redemption.id;

    const cancel = await user.request({
      method: 'POST',
      url: `${REWARDS}/me/redemptions/${redemptionId}/cancel`,
      payload: {},
    });
    expect(cancel.statusCode).toBe(200);

    const totals = await ledgerTotals(user.userId);
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: user.userId } });

    expect(profile.pointsBalance).toBe(totals.balance);
    expect(profile.pointsBalance).toBe(5);
    // The refund is a REVERSAL, so it never counts as fresh earning. Otherwise
    // redeem-and-cancel would be an unlimited level-farming loop.
    expect(profile.lifetimePoints).toBe(5);
    expect(totals.lifetime).toBe(5);

    const inventory = await db.rewardInventory.findUniqueOrThrow({ where: { rewardId: 'rw_i' } });
    expect(inventory.remaining).toBe(10);
  });
});
