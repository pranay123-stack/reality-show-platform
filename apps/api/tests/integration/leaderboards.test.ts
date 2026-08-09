import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { redis } from '../../src/core/redis.js';
import {
  getLeaderboard,
  snapshotLeaderboard,
} from '../../src/modules/leaderboards/leaderboards.service.js';
import { periodKeyFor } from '../../src/modules/leaderboards/periods.js';
import {
  LEADERBOARD_KEYS,
  projectEntry,
  syncLeaderboards,
} from '../../src/modules/leaderboards/projector.js';
import { awardPoints, spendPoints } from '../../src/modules/points/points.service.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const BOARDS = `${API_PREFIX}/leaderboards`;
const TZ = 'UTC';

let app: FastifyInstance;
let sharedHash: string;

beforeAll(async () => {
  app = await buildTestApp();
  sharedHash = await hashPassword(VALID_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetAll();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeUser(
  handle: string,
  options: { role?: 'USER' | 'MODERATOR' | 'PRODUCER' | 'ADMIN'; login?: boolean } = {},
) {
  const email = `${handle}@test.local`;
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: sharedHash,
      role: options.role ?? 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: handle } },
    },
    select: { id: true },
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

/**
 * Writes a ledger row directly, with an explicit timestamp.
 *
 * Direct rather than through `awardPoints` because these tests need to place
 * activity in a *past* period to prove the daily and weekly windows really are
 * windows, and the award path always stamps now.
 */
let ledgerSequence = 0;
async function ledgerEntry(
  userId: string,
  delta: number,
  options: { at?: Date; entryType?: 'EARN' | 'SPEND' | 'REVERSAL' | 'ADJUSTMENT' } = {},
) {
  ledgerSequence += 1;
  return db.pointsLedger.create({
    data: {
      userId,
      delta,
      balanceAfter: delta,
      entryType: options.entryType ?? 'EARN',
      sourceType: 'ACHIEVEMENT',
      sourceId: `src_${ledgerSequence}`,
      reason: `reason_${ledgerSequence}`,
      createdAt: options.at ?? new Date(),
    },
  });
}

const seasonKey = () => periodKeyFor('SEASON', new Date(), TZ);
const dailyKey = (at = new Date()) => periodKeyFor('DAILY', at, TZ);
const weeklyKey = (at = new Date()) => periodKeyFor('WEEKLY', at, TZ);

const boardScore = async (window: 'DAILY' | 'WEEKLY' | 'SEASON', key: string, userId: string) => {
  const raw = await redis.zscore(LEADERBOARD_KEYS.board(window, key), userId);
  return raw === null ? null : Number(raw);
};

// ---------------------------------------------------------------------------
// 1. Points create a leaderboard update
// ---------------------------------------------------------------------------

describe('points drive the leaderboard', () => {
  it('projects an award onto every window', async () => {
    const viewer = await makeUser('viewer', { login: false });
    await awardPoints({
      userId: viewer.userId,
      points: 120,
      sourceType: 'PREDICTION',
      sourceId: 'pred_1',
      reason: 'correct',
    });

    await syncLeaderboards();

    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(120);
    expect(await boardScore('DAILY', dailyKey(), viewer.userId)).toBe(120);
    expect(await boardScore('WEEKLY', weeklyKey(), viewer.userId)).toBe(120);
  });

  it('never lets a client submit its own score', async () => {
    const viewer = await makeUser('viewer');

    // There is deliberately no endpoint that accepts points, a score or a rank.
    for (const url of [`${BOARDS}`, `${BOARDS}/me`]) {
      const response = await viewer.request({
        method: 'POST',
        url,
        payload: { points: 999_999, rank: 1 },
      });
      expect(response.statusCode).toBe(404);
    }

    await syncLeaderboards();
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBeNull();
  });

  it('does not let spending points cost a user their place', async () => {
    // The same principle as "spending never costs you a level": redeeming a
    // reward must not push someone down the board.
    const viewer = await makeUser('viewer', { login: false });
    await awardPoints({
      userId: viewer.userId,
      points: 500,
      sourceType: 'ACHIEVEMENT',
      sourceId: 'ach_1',
      reason: 'earned',
    });
    await spendPoints({
      userId: viewer.userId,
      points: 300,
      sourceType: 'REWARD_REDEMPTION',
      sourceId: 'rew_1',
      reason: 'redeem:1',
    });

    await syncLeaderboards();

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(200);
    // Balance fell; standing did not.
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(500);
  });

  it('subtracts a clawback of an award', async () => {
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 400);
    await ledgerEntry(viewer.userId, -150, { entryType: 'REVERSAL' });

    await syncLeaderboards();
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. Order and ties
// ---------------------------------------------------------------------------

describe('ranking order', () => {
  it('ranks highest first', async () => {
    const top = await makeUser('top', { login: false });
    const middle = await makeUser('middle', { login: false });
    const bottom = await makeUser('bottom', { login: false });

    await ledgerEntry(top.userId, 900);
    await ledgerEntry(middle.userId, 500);
    await ledgerEntry(bottom.userId, 100);
    await syncLeaderboards();

    const board = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 10 });
    expect(board.rows.map((row) => [row.displayName, row.rank, row.points])).toEqual([
      ['top', 1, 900],
      ['middle', 2, 500],
      ['bottom', 3, 100],
    ]);
    expect(board.totalRanked).toBe(3);
  });

  it('gives tied users the same rank and skips the next', async () => {
    const first = await makeUser('first', { login: false });
    const tiedA = await makeUser('tiedA', { login: false });
    const tiedB = await makeUser('tiedB', { login: false });
    const last = await makeUser('last', { login: false });

    await ledgerEntry(first.userId, 900);
    await ledgerEntry(tiedA.userId, 500, { at: new Date(Date.now() - 60_000) });
    await ledgerEntry(tiedB.userId, 500);
    await ledgerEntry(last.userId, 100);
    await syncLeaderboards();

    const board = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 10 });
    expect(board.rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
    // Whoever got there first is shown first, deterministically.
    expect(board.rows[1]!.displayName).toBe('tiedA');
    expect(board.rows[2]!.displayName).toBe('tiedB');
  });

  it('reports the viewer’s own position and percentile', async () => {
    const viewer = await makeUser('viewer');
    const rival = await makeUser('rival', { login: false });

    await ledgerEntry(rival.userId, 900);
    await ledgerEntry(viewer.userId, 300);
    await syncLeaderboards();

    const response = await viewer.request({ method: 'GET', url: `${BOARDS}?window=SEASON` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.me).toMatchObject({ rank: 2, points: 300, percentile: 0 });
    expect(response.json().data.rows.find((row: { isYou: boolean }) => row.isYou)).toBeTruthy();
  });

  it('pages by rank rather than by cursor', async () => {
    const users = [];
    for (let index = 0; index < 5; index += 1) {
      const user = await makeUser(`user${index}`, { login: false });
      await ledgerEntry(user.userId, (5 - index) * 100);
      users.push(user);
    }
    await syncLeaderboards();

    const page = await getLeaderboard(null, { window: 'SEASON', offset: 2, limit: 2 });
    expect(page.rows.map((row) => row.rank)).toEqual([3, 4]);
  });
});

// ---------------------------------------------------------------------------
// 4, 5, 6. Time windows
// ---------------------------------------------------------------------------

describe('time windows', () => {
  it('starts the daily board empty again the next day', async () => {
    const viewer = await makeUser('viewer', { login: false });
    const yesterday = new Date(Date.now() - 26 * 3_600_000);

    await ledgerEntry(viewer.userId, 400, { at: yesterday });
    await ledgerEntry(viewer.userId, 150);
    await syncLeaderboards();

    expect(await boardScore('DAILY', dailyKey(yesterday), viewer.userId)).toBe(400);
    // Today counts only today.
    expect(await boardScore('DAILY', dailyKey(), viewer.userId)).toBe(150);
  });

  it('starts the weekly board empty again the next week', async () => {
    const viewer = await makeUser('viewer', { login: false });
    const lastWeek = new Date(Date.now() - 9 * 86_400_000);

    await ledgerEntry(viewer.userId, 700, { at: lastWeek });
    await ledgerEntry(viewer.userId, 250);
    await syncLeaderboards();

    expect(await boardScore('WEEKLY', weeklyKey(lastWeek), viewer.userId)).toBe(700);
    expect(await boardScore('WEEKLY', weeklyKey(), viewer.userId)).toBe(250);
  });

  it('accumulates the season across every period', async () => {
    const viewer = await makeUser('viewer', { login: false });

    await ledgerEntry(viewer.userId, 700, { at: new Date(Date.now() - 40 * 86_400_000) });
    await ledgerEntry(viewer.userId, 400, { at: new Date(Date.now() - 9 * 86_400_000) });
    await ledgerEntry(viewer.userId, 150);
    await syncLeaderboards();

    // The season never resets, so it holds everything the other two shed.
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(1250);
    expect(await boardScore('DAILY', dailyKey(), viewer.userId)).toBe(150);
  });

  it('reports the period boundary it is using, and the zone that defined it', async () => {
    const board = await getLeaderboard(null, { window: 'DAILY', offset: 0, limit: 10 });
    expect(board.timezone).toBe(TZ);
    expect(board.periodStart).toMatch(/T00:00:00/);
    expect(board.periodEnd).not.toBeNull();

    const season = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 10 });
    expect(season.periodEnd).toBeNull();
  });

  it('refuses a malformed period key instead of guessing', async () => {
    await expect(
      getLeaderboard(null, { window: 'DAILY', offset: 0, limit: 10, periodKey: 'yesterday' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

// ---------------------------------------------------------------------------
// 7. Friends and privacy
// ---------------------------------------------------------------------------

describe('friends leaderboard and privacy', () => {
  async function befriend(a: string, b: string, status: 'ACCEPTED' | 'PENDING' = 'ACCEPTED') {
    await db.userConnection.create({
      data: { requesterId: a, addresseeId: b, kind: 'FRIEND', status },
    });
  }

  it('ranks you against accepted friends only', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('friend', { login: false });
    const pending = await makeUser('pending', { login: false });
    const stranger = await makeUser('stranger', { login: false });

    await befriend(me.userId, friend.userId);
    await befriend(pending.userId, me.userId, 'PENDING');

    await ledgerEntry(stranger.userId, 5000);
    await ledgerEntry(pending.userId, 4000);
    await ledgerEntry(friend.userId, 300);
    await ledgerEntry(me.userId, 800);
    await syncLeaderboards();

    const response = await me.request({ method: 'GET', url: `${BOARDS}/friends?window=SEASON` });
    const names = response.json().data.rows.map((row: { displayName: string }) => row.displayName);

    expect(names).toEqual(['me', 'friend']);
    // Ranks are relative to the circle: top of your friends is #1, even though
    // a stranger is far ahead globally.
    expect(response.json().data.rows[0]).toMatchObject({ rank: 1, isYou: true });
  });

  it('does not let a one-sided follow into a private circle', async () => {
    const me = await makeUser('me');
    const follower = await makeUser('follower', { login: false });

    await db.userConnection.create({
      data: { requesterId: follower.userId, addresseeId: me.userId, kind: 'FOLLOW', status: 'ACCEPTED' },
    });
    await ledgerEntry(follower.userId, 900);
    await ledgerEntry(me.userId, 100);
    await syncLeaderboards();

    const response = await me.request({ method: 'GET', url: `${BOARDS}/friends` });
    expect(response.json().data.rows.map((row: { displayName: string }) => row.displayName)).toEqual(
      ['me'],
    );
  });

  it('hides an opted-out user from everyone else’s board', async () => {
    const shy = await makeUser('shy');
    const other = await makeUser('other');

    await ledgerEntry(shy.userId, 900);
    await ledgerEntry(other.userId, 100);
    await syncLeaderboards();

    const optOut = await shy.request({
      method: 'PATCH',
      url: `${BOARDS}/me/privacy`,
      payload: { leaderboardVisible: false },
    });
    expect(optOut.statusCode).toBe(200);

    const asOther = await other.request({ method: 'GET', url: `${BOARDS}?window=SEASON` });
    const names = asOther.json().data.rows.map((row: { displayName: string }) => row.displayName);
    expect(names).toEqual(['other']);

    // Crucially, hiding does not promote anyone: `other` is still second,
    // because the person ahead of them still exists.
    expect(asOther.json().data.rows[0]!.rank).toBe(2);
  });

  it('still tells an opted-out user their own true position', async () => {
    const shy = await makeUser('shy');
    const other = await makeUser('other', { login: false });

    await ledgerEntry(shy.userId, 900);
    await ledgerEntry(other.userId, 100);
    await syncLeaderboards();
    await shy.request({
      method: 'PATCH',
      url: `${BOARDS}/me/privacy`,
      payload: { leaderboardVisible: false },
    });

    const mine = await shy.request({ method: 'GET', url: `${BOARDS}?window=SEASON` });
    expect(mine.json().data.me).toMatchObject({ rank: 1, points: 900, hidden: true });
    expect(mine.json().data.rows[0]).toMatchObject({ displayName: 'shy', isYou: true });
  });

  it('runs the friend request handshake and refuses a stranger’s answer', async () => {
    const asker = await makeUser('asker');
    const target = await makeUser('target');
    const nosy = await makeUser('nosy');

    const request = await asker.request({
      method: 'POST',
      url: `${BOARDS}/connections`,
      payload: { userId: target.userId, kind: 'FRIEND' },
    });
    expect(request.statusCode).toBe(201);
    expect(request.json().data.status).toBe('PENDING');
    const connectionId = request.json().data.id as string;

    const hijack = await nosy.request({
      method: 'POST',
      url: `${BOARDS}/connections/${connectionId}/respond`,
      payload: { accept: true },
    });
    expect(hijack.statusCode).toBe(403);

    const accept = await target.request({
      method: 'POST',
      url: `${BOARDS}/connections/${connectionId}/respond`,
      payload: { accept: true },
    });
    expect(accept.json().data.status).toBe('ACCEPTED');

    const twice = await asker.request({
      method: 'POST',
      url: `${BOARDS}/connections`,
      payload: { userId: target.userId, kind: 'FRIEND' },
    });
    expect(twice.statusCode).toBe(409);
  });

  it('refuses a self-connection', async () => {
    const me = await makeUser('me');
    const response = await me.request({
      method: 'POST',
      url: `${BOARDS}/connections`,
      payload: { userId: me.userId, kind: 'FRIEND' },
    });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 8. Communities
// ---------------------------------------------------------------------------

describe('community leaderboard', () => {
  async function makeCommunity(slug: string, options: { isPrivate?: boolean } = {}) {
    const type = await db.communityType.upsert({
      where: { key: 'city' },
      update: {},
      create: { key: 'city', label: 'City' },
    });
    return db.community.create({
      data: {
        typeId: type.id,
        slug,
        name: slug,
        isPrivate: options.isPrivate ?? false,
      },
    });
  }

  it('ranks only that community’s members', async () => {
    const community = await makeCommunity('mumbai');
    const member = await makeUser('member');
    const otherMember = await makeUser('otherMember', { login: false });
    const outsider = await makeUser('outsider', { login: false });

    await db.communityMember.createMany({
      data: [
        { communityId: community.id, userId: member.userId },
        { communityId: community.id, userId: otherMember.userId },
      ],
    });

    await ledgerEntry(outsider.userId, 9000);
    await ledgerEntry(member.userId, 400);
    await ledgerEntry(otherMember.userId, 700);
    await syncLeaderboards();

    const response = await member.request({
      method: 'GET',
      url: `${BOARDS}/community?communityId=${community.id}&window=SEASON`,
    });
    expect(response.statusCode).toBe(200);
    const names = response.json().data.rows.map((row: { displayName: string }) => row.displayName);
    expect(names).toEqual(['otherMember', 'member']);
    expect(response.json().data.community.name).toBe('mumbai');
  });

  it('brings a joiner’s existing score onto the board', async () => {
    const community = await makeCommunity('latecomers');
    const joiner = await makeUser('joiner');

    await ledgerEntry(joiner.userId, 650);
    await syncLeaderboards();

    const join = await joiner.request({
      method: 'POST',
      url: `${BOARDS}/communities/${community.id}/join`,
    });
    expect(join.statusCode).toBe(200);

    const board = await joiner.request({
      method: 'GET',
      url: `${BOARDS}/community?communityId=${community.id}`,
    });
    expect(board.json().data.rows[0]).toMatchObject({ displayName: 'joiner', points: 650 });
  });

  it('drops a leaver from the board', async () => {
    const community = await makeCommunity('leavers');
    const leaver = await makeUser('leaver');

    await ledgerEntry(leaver.userId, 300);
    await syncLeaderboards();
    await leaver.request({ method: 'POST', url: `${BOARDS}/communities/${community.id}/join` });
    await leaver.request({ method: 'POST', url: `${BOARDS}/communities/${community.id}/leave` });

    const board = await leaver.request({
      method: 'GET',
      url: `${BOARDS}/community?communityId=${community.id}`,
    });
    expect(board.json().data.rows).toHaveLength(0);
  });

  it('keeps a private community’s ranking to its members', async () => {
    const community = await makeCommunity('insiders', { isPrivate: true });
    const member = await makeUser('member');
    const outsider = await makeUser('outsider');

    await db.communityMember.create({
      data: { communityId: community.id, userId: member.userId },
    });

    const asOutsider = await outsider.request({
      method: 'GET',
      url: `${BOARDS}/community?communityId=${community.id}`,
    });
    expect(asOutsider.statusCode).toBe(403);

    const asMember = await member.request({
      method: 'GET',
      url: `${BOARDS}/community?communityId=${community.id}`,
    });
    expect(asMember.statusCode).toBe(200);
  });

  it('keeps community types configurable rather than hardcoded', async () => {
    const producer = await makeUser('producer', { role: 'PRODUCER' });

    const created = await producer.request({
      method: 'POST',
      url: `${BOARDS}/admin/community-types`,
      payload: { key: 'book_club', label: 'Book club' },
    });
    expect(created.statusCode).toBe(201);

    const community = await producer.request({
      method: 'POST',
      url: `${BOARDS}/admin/communities`,
      payload: { typeKey: 'book_club', slug: 'tuesday-readers', name: 'Tuesday Readers' },
    });
    expect(community.statusCode).toBe(201);

    const types = await producer.request({ method: 'GET', url: `${BOARDS}/communities/types` });
    expect(types.json().data.map((type: { key: string }) => type.key)).toContain('book_club');
  });
});

// ---------------------------------------------------------------------------
// 9. Rebuild
// ---------------------------------------------------------------------------

describe('rebuilding from the ledger', () => {
  it('restores the whole board after the cache is lost', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const one = await makeUser('one', { login: false });
    const two = await makeUser('two', { login: false });

    await ledgerEntry(one.userId, 800);
    await ledgerEntry(two.userId, 450);
    await syncLeaderboards();
    expect(await boardScore('SEASON', seasonKey(), one.userId)).toBe(800);

    // Simulate losing Redis entirely.
    const keys = await redis.keys('lb:*');
    if (keys.length > 0) await redis.del(...keys);
    expect(await boardScore('SEASON', seasonKey(), one.userId)).toBeNull();

    const rebuild = await admin.request({
      method: 'POST',
      url: `${BOARDS}/admin/rebuild`,
      payload: { window: 'SEASON' },
    });
    expect(rebuild.statusCode).toBe(200);
    expect(rebuild.json().data).toMatchObject({ users: 2, totalPoints: 1250 });

    expect(await boardScore('SEASON', seasonKey(), one.userId)).toBe(800);
    expect(await boardScore('SEASON', seasonKey(), two.userId)).toBe(450);
  });

  it('rebuilds every window at once', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 500);

    const response = await admin.request({ method: 'POST', url: `${BOARDS}/admin/rebuild-all` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(3);

    expect(await boardScore('DAILY', dailyKey(), viewer.userId)).toBe(500);
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(500);
  });

  it('does not double-count when a sync follows a rebuild', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 500);

    await admin.request({ method: 'POST', url: `${BOARDS}/admin/rebuild-all` });
    // The drainer re-reads its overlap window straight after; the guards the
    // rebuild armed are what stop it counting the same rows again.
    await syncLeaderboards();
    await syncLeaderboards();

    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 10. Duplicate and replayed events
// ---------------------------------------------------------------------------

describe('duplicate event processing', () => {
  it('applies an entry once however many times it is projected', async () => {
    const viewer = await makeUser('viewer', { login: false });
    const entry = await ledgerEntry(viewer.userId, 250);

    const first = await projectEntry(entry);
    const second = await projectEntry(entry);
    const third = await projectEntry(entry);

    // Three windows moved once; the replays moved nothing.
    expect(first).toBe(3);
    expect(second).toBe(0);
    expect(third).toBe(0);
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(250);
  });

  it('is idempotent across repeated drains', async () => {
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 300);

    for (let pass = 0; pass < 5; pass += 1) await syncLeaderboards();

    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(300);
  });

  it('survives the same entry being projected concurrently', async () => {
    const viewer = await makeUser('viewer', { login: false });
    const entry = await ledgerEntry(viewer.userId, 100);

    const results = await Promise.all(Array.from({ length: 20 }, () => projectEntry(entry)));

    // Exactly one caller won each window.
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(100);
  });

  it('keeps the award path itself idempotent end to end', async () => {
    const viewer = await makeUser('viewer', { login: false });
    const award = {
      userId: viewer.userId,
      points: 75,
      sourceType: 'POLL' as const,
      sourceId: 'poll_1',
      reason: 'participation',
    };

    await awardPoints(award);
    await awardPoints(award);
    await awardPoints(award);
    await syncLeaderboards();

    expect(await db.pointsLedger.count({ where: { userId: viewer.userId } })).toBe(1);
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// 11. Authorisation
// ---------------------------------------------------------------------------

describe('administration permissions', () => {
  it('refuses every admin action to an ordinary user', async () => {
    const viewer = await makeUser('viewer');

    const rebuild = await viewer.request({
      method: 'POST',
      url: `${BOARDS}/admin/rebuild`,
      payload: { window: 'SEASON' },
    });
    expect(rebuild.statusCode).toBe(403);

    const freeze = await viewer.request({
      method: 'POST',
      url: `${BOARDS}/admin/freeze`,
      payload: { window: 'SEASON', frozen: true },
    });
    expect(freeze.statusCode).toBe(403);

    const exported = await viewer.request({
      method: 'GET',
      url: `${BOARDS}/admin/export?window=SEASON`,
    });
    expect(exported.statusCode).toBe(403);

    const inspect = await viewer.request({
      method: 'GET',
      url: `${BOARDS}/admin/inspect?window=SEASON&userId=${viewer.userId}`,
    });
    expect(inspect.statusCode).toBe(403);
  });

  it('lets a moderator inspect but not rebuild', async () => {
    const moderator = await makeUser('moderator', { role: 'MODERATOR' });
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 400);
    await syncLeaderboards();

    const inspect = await moderator.request({
      method: 'GET',
      url: `${BOARDS}/admin/inspect?window=SEASON&userId=${viewer.userId}`,
    });
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json().data).toMatchObject({
      cachedScore: 400,
      ledgerScore: 400,
      consistent: true,
      rank: 1,
    });

    const rebuild = await moderator.request({
      method: 'POST',
      url: `${BOARDS}/admin/rebuild`,
      payload: { window: 'SEASON' },
    });
    expect(rebuild.statusCode).toBe(403);
  });

  it('reserves freezing and exporting for an admin', async () => {
    const producer = await makeUser('producer', { role: 'PRODUCER' });
    const admin = await makeUser('admin', { role: 'ADMIN' });

    // A producer runs the boards but does not settle who won.
    expect(
      (
        await producer.request({
          method: 'POST',
          url: `${BOARDS}/admin/rebuild`,
          payload: { window: 'SEASON' },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await producer.request({
          method: 'POST',
          url: `${BOARDS}/admin/freeze`,
          payload: { window: 'SEASON', frozen: true },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await admin.request({
          method: 'POST',
          url: `${BOARDS}/admin/freeze`,
          payload: { window: 'SEASON', frozen: true, reason: 'Settling the weekly prize' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('freezes a board against further movement, and recovers on unfreeze', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const viewer = await makeUser('viewer', { login: false });

    await ledgerEntry(viewer.userId, 100);
    await syncLeaderboards();

    await admin.request({
      method: 'POST',
      url: `${BOARDS}/admin/freeze`,
      payload: { window: 'SEASON', frozen: true },
    });

    await ledgerEntry(viewer.userId, 900);
    await syncLeaderboards();
    // Frozen: the ledger moved, the board did not.
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(100);

    const board = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 10 });
    expect(board.frozen).toBe(true);

    await admin.request({
      method: 'POST',
      url: `${BOARDS}/admin/freeze`,
      payload: { window: 'SEASON', frozen: false },
    });

    // Unfreezing rebuilds, so the entries that arrived meanwhile are not lost.
    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(1000);
  });

  it('writes an audit entry for every admin action', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });

    await admin.request({
      method: 'POST',
      url: `${BOARDS}/admin/rebuild`,
      payload: { window: 'SEASON' },
    });
    await admin.request({
      method: 'POST',
      url: `${BOARDS}/admin/freeze`,
      payload: { window: 'SEASON', frozen: true },
    });
    await admin.request({ method: 'GET', url: `${BOARDS}/admin/export?window=SEASON` });

    const actions = (await db.auditLog.findMany({ select: { action: true } })).map(
      (row) => row.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['leaderboard.rebuild', 'leaderboard.freeze', 'leaderboard.export']),
    );
  });

  it('exports the standings as CSV', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 640);
    await syncLeaderboards();

    const response = await admin.request({
      method: 'GET',
      url: `${BOARDS}/admin/export?window=SEASON&format=csv`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.body).toContain('rank,userId,displayName,points');
    expect(response.body).toContain('640');
  });
});

// ---------------------------------------------------------------------------
// Snapshots and rank movement
// ---------------------------------------------------------------------------

describe('snapshots and rank movement', () => {
  it('reports movement against the previous snapshot', async () => {
    const climber = await makeUser('climber', { login: false });
    const faller = await makeUser('faller', { login: false });

    await ledgerEntry(faller.userId, 900);
    await ledgerEntry(climber.userId, 100);
    await syncLeaderboards();
    await snapshotLeaderboard('SEASON');

    // The climber overtakes.
    await ledgerEntry(climber.userId, 1500);
    await syncLeaderboards();

    const board = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 10 });
    expect(board.rows[0]).toMatchObject({
      displayName: 'climber',
      rank: 1,
      previousRank: 2,
      movement: 1,
    });
    expect(board.rows[1]).toMatchObject({ displayName: 'faller', rank: 2, movement: -1 });
  });

  it('reports no movement for a user who has never been ranked before', async () => {
    const fresh = await makeUser('fresh', { login: false });
    await ledgerEntry(fresh.userId, 200);
    await syncLeaderboards();

    const board = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 10 });
    expect(board.rows[0]!.movement).toBeNull();
  });

  it('persists the standings for history', async () => {
    const viewer = await makeUser('viewer', { login: false });
    await ledgerEntry(viewer.userId, 375);
    await syncLeaderboards();

    const snapshot = await snapshotLeaderboard('SEASON');
    expect(snapshot.entryCount).toBe(1);

    const stored = await db.leaderboardEntry.findFirstOrThrow({
      where: { leaderboardId: snapshot.id },
    });
    expect(stored).toMatchObject({ rank: 1, points: 375 });
    expect(stored.tieBreaker).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Concurrency: the scenario from the brief
// ---------------------------------------------------------------------------

describe('concurrent point events', () => {
  it('loses no updates when 1000 events arrive at once', async () => {
    const users = [];
    for (let index = 0; index < 10; index += 1) {
      users.push(await makeUser(`racer${index}`, { login: false }));
    }

    // 1000 ledger rows: 100 per user, each worth their index + 1 points, so the
    // correct final ranking is known in advance and strictly ordered.
    const rows = [];
    for (const [index, user] of users.entries()) {
      for (let n = 0; n < 100; n += 1) {
        rows.push({
          userId: user.userId,
          delta: index + 1,
          balanceAfter: 0,
          entryType: 'EARN' as const,
          sourceType: 'ACHIEVEMENT' as const,
          sourceId: `race_${index}_${n}`,
          reason: 'burst',
        });
      }
    }
    await db.pointsLedger.createMany({ data: rows });

    const entries = await db.pointsLedger.findMany({
      select: { id: true, userId: true, delta: true, entryType: true, createdAt: true },
    });
    expect(entries).toHaveLength(1000);

    // All 1000 projected simultaneously — the actual test.
    const applied = await Promise.all(entries.map((entry) => projectEntry(entry)));
    expect(applied.reduce((sum, value) => sum + value, 0)).toBe(3000);

    // Every score is exactly 100 × its user's per-event value: nothing lost,
    // nothing counted twice.
    for (const [index, user] of users.entries()) {
      expect(await boardScore('SEASON', seasonKey(), user.userId)).toBe((index + 1) * 100);
    }

    const board = await getLeaderboard(null, { window: 'SEASON', offset: 0, limit: 20 });
    expect(board.totalRanked).toBe(10);
    expect(board.rows.map((row) => row.displayName)).toEqual(
      users.map((_, index) => `racer${9 - index}`),
    );
    expect(board.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // And the cache agrees with the ledger it was derived from.
    const ledgerTotal = rows.reduce((sum, row) => sum + row.delta, 0);
    const boardTotal = board.rows.reduce((sum, row) => sum + row.points, 0);
    expect(boardTotal).toBe(ledgerTotal);
  }, 120_000);

  it('stays correct when the same 1000 events are also replayed concurrently', async () => {
    const viewer = await makeUser('viewer', { login: false });

    await db.pointsLedger.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        userId: viewer.userId,
        delta: 5,
        balanceAfter: 0,
        entryType: 'EARN' as const,
        sourceType: 'ACHIEVEMENT' as const,
        sourceId: `replay_${index}`,
        reason: 'burst',
      })),
    });

    const entries = await db.pointsLedger.findMany({
      select: { id: true, userId: true, delta: true, entryType: true, createdAt: true },
    });

    // Each entry projected five times, all at once.
    await Promise.all(
      entries.flatMap((entry) => Array.from({ length: 5 }, () => projectEntry(entry))),
    );

    expect(await boardScore('SEASON', seasonKey(), viewer.userId)).toBe(1000);
  }, 120_000);
});
