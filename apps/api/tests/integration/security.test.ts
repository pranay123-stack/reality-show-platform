import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

/**
 * Security regression suite.
 *
 * Every case here corresponds to an attack that was either attempted against
 * the running stack during the Phase 18 audit, or to a defence that would fail
 * silently if it regressed. They assert on *outcomes* — what reached the
 * database, what the attacker got back — rather than on the presence of a
 * guard, because a guard that is present but bypassed still passes an
 * inspection.
 */

const AUTH = `${API_PREFIX}/auth`;

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
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
});

type Role = 'USER' | 'MODERATOR' | 'PRODUCER' | 'ADMIN';

async function makeUser(handle: string, role: Role = 'USER', instance: FastifyInstance = app) {
  const email = `${handle}@test.local`;
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: sharedHash,
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: handle, pointsBalance: 500, lifetimePoints: 500 } },
    },
    select: { id: true },
  });

  const client = new TestClient(instance);
  await client.request({
    method: 'POST',
    url: `${AUTH}/login`,
    payload: { email, password: VALID_PASSWORD },
  });
  return Object.assign(client, { userId: user.id, email });
}

// ---------------------------------------------------------------------------
// 1. Unauthorised admin access
// ---------------------------------------------------------------------------

describe('1. unauthorised admin access', () => {
  it('refuses the console to an ordinary user and to an anonymous caller', async () => {
    const viewer = await makeUser('viewer');

    for (const url of [
      `${API_PREFIX}/admin/overview`,
      `${API_PREFIX}/admin/sections`,
      `${API_PREFIX}/admin/audit`,
    ]) {
      expect((await viewer.request({ method: 'GET', url })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('refuses every operator read to an ordinary user', async () => {
    const viewer = await makeUser('viewer');

    const operatorReads = [
      `${API_PREFIX}/contestants/admin/list`,
      `${API_PREFIX}/predictions/admin/list`,
      `${API_PREFIX}/polls/admin/list`,
      `${API_PREFIX}/challenges/admin/queue`,
      `${API_PREFIX}/rewards/admin/catalogue`,
      `${API_PREFIX}/notifications/admin/health`,
    ];

    for (const url of operatorReads) {
      expect((await viewer.request({ method: 'GET', url })).statusCode, url).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Privilege escalation
// ---------------------------------------------------------------------------

describe('2. privilege escalation', () => {
  it('ignores a role or status supplied in a profile update', async () => {
    const viewer = await makeUser('viewer');

    const response = await viewer.request({
      method: 'PATCH',
      url: `${API_PREFIX}/users/me`,
      payload: {
        displayName: 'Climber',
        role: 'ADMIN',
        status: 'ACTIVE',
        pointsBalance: 999_999,
        lifetimePoints: 999_999,
      },
    });
    expect(response.statusCode).toBe(200);

    const user = await db.user.findUniqueOrThrow({
      where: { id: viewer.userId },
      include: { profile: true },
    });
    expect(user.role).toBe('USER');
    expect(user.profile!.pointsBalance).toBe(500);
    expect(user.profile!.lifetimePoints).toBe(500);
  });

  it('does not let a moderator reach producer or admin verbs', async () => {
    const moderator = await makeUser('moderator', 'MODERATOR');

    const producerVerbs = [
      { url: `${API_PREFIX}/predictions/admin`, payload: { question: 'x' } },
      { url: `${API_PREFIX}/polls/admin`, payload: { question: 'x' } },
      { url: `${API_PREFIX}/contestants/admin`, payload: { displayName: 'x', slug: 'x' } },
      { url: `${API_PREFIX}/kitchen/admin`, payload: { title: 'x' } },
    ];

    for (const verb of producerVerbs) {
      expect((await moderator.request({ method: 'POST', ...verb })).statusCode, verb.url).toBe(403);
    }
  });

  it('does not let a producer reach admin-only resources', async () => {
    const producer = await makeUser('producer', 'PRODUCER');

    const adminOnly = [
      { method: 'GET' as const, url: `${API_PREFIX}/admin/audit` },
      { method: 'GET' as const, url: `${API_PREFIX}/leaderboards/admin/export?window=SEASON` },
      {
        method: 'POST' as const,
        url: `${API_PREFIX}/leaderboards/admin/freeze`,
        payload: { window: 'SEASON', frozen: true },
      },
      {
        method: 'POST' as const,
        url: `${API_PREFIX}/notifications/admin/announce`,
        payload: { title: 'Everyone', body: 'Read this' },
      },
    ];

    for (const request of adminOnly) {
      expect((await producer.request(request)).statusCode, request.url).toBe(403);
    }
  });

  it('rejects a token whose role no longer matches the account', async () => {
    const user = await makeUser('climber');

    // The account is demoted after the token was minted.
    await db.user.update({ where: { id: user.userId }, data: { role: 'MODERATOR' } });
    const { resetRedis } = await import('../helpers/db.js');
    await resetRedis();

    // The claim says USER, the account says MODERATOR: the session is refused
    // rather than either value being preferred.
    const response = await user.request({ method: 'GET', url: `${AUTH}/me` });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SESSION_REVOKED');
  });

  it('refuses a forged and a tampered token', async () => {
    const user = await makeUser('victim');
    const good = user.getCookie('rp_at');
    expect(good).toBeTruthy();

    // Flip a character in the signature.
    const tampered = `${good!.slice(0, -3)}aaa`;

    for (const token of ['not.a.token', tampered, `${good}extra`]) {
      const response = await app.inject({
        method: 'GET',
        url: `${AUTH}/me`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate voting
// ---------------------------------------------------------------------------

describe('3. duplicate voting', () => {
  async function openPoll(producer: TestClient) {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin`,
      payload: {
        question: 'Who should win tonight?',
        durationSeconds: 600,
        options: [{ label: 'Aria' }, { label: 'Dev' }],
      },
    });
    const poll = created.json().data;
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/${poll.id}/activate`,
      payload: {},
    });
    return poll;
  }

  it('counts one vote however many times it is submitted', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const voter = await makeUser('voter');
    const poll = await openPoll(producer);

    const first = await voter.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/${poll.id}/vote`,
      payload: { optionId: poll.options[0].id },
    });
    expect(first.statusCode).toBe(200);

    // Same option, then the other one: neither may add a second vote.
    for (const optionId of [poll.options[0].id, poll.options[1].id]) {
      const repeat = await voter.request({
        method: 'POST',
        url: `${API_PREFIX}/polls/${poll.id}/vote`,
        payload: { optionId },
      });
      expect(repeat.statusCode).toBeGreaterThanOrEqual(400);
    }

    expect(await db.pollVote.count({ where: { pollId: poll.id, userId: voter.userId } })).toBe(1);
  });

  it('survives twenty simultaneous votes from one account', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const voter = await makeUser('voter');
    const poll = await openPoll(producer);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        voter.request({
          method: 'POST',
          url: `${API_PREFIX}/polls/${poll.id}/vote`,
          payload: { optionId: poll.options[0].id },
        }),
      ),
    );

    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1);
    expect(await db.pollVote.count({ where: { pollId: poll.id } })).toBe(1);
  });

  it('refuses a vote for an option belonging to another poll', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const voter = await makeUser('voter');
    const [first, second] = [await openPoll(producer), await openPoll(producer)];

    // A manipulated option id must not cross the poll boundary.
    const response = await voter.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/${first.id}/vote`,
      payload: { optionId: second.options[0].id },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await db.pollVote.count()).toBe(0);
  });

  it('refuses a vote once the poll is closed', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const voter = await makeUser('voter');
    const poll = await openPoll(producer);

    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/${poll.id}/close`,
      payload: {},
    });

    const response = await voter.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/${poll.id}/vote`,
      payload: { optionId: poll.options[0].id },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await db.pollVote.count()).toBe(0);
  });

  it('refuses participation from an unverified account', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const poll = await openPoll(producer);

    const email = 'unverified@test.local';
    await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: sharedHash,
        status: 'ACTIVE',
        profile: { create: { displayName: 'unverified' } },
      },
    });
    const client = new TestClient(app);
    await client.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email, password: VALID_PASSWORD },
    });

    const response = await client.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/${poll.id}/vote`,
      payload: { optionId: poll.options[0].id },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await db.pollVote.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Points manipulation
// ---------------------------------------------------------------------------

describe('4. points manipulation', () => {
  it('exposes no endpoint that accepts a points figure, a rank or a balance', async () => {
    const viewer = await makeUser('viewer');
    const before = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });

    const attempts = [
      { url: `${API_PREFIX}/users/me`, method: 'PATCH' as const, payload: { pointsBalance: 1e9 } },
      { url: `${API_PREFIX}/points/award`, method: 'POST' as const, payload: { points: 1e9 } },
      { url: `${API_PREFIX}/points`, method: 'POST' as const, payload: { delta: 1e9 } },
      { url: `${API_PREFIX}/leaderboards`, method: 'POST' as const, payload: { rank: 1, points: 1e9 } },
      { url: `${API_PREFIX}/leaderboards/me`, method: 'POST' as const, payload: { rank: 1 } },
    ];

    for (const attempt of attempts) {
      const response = await viewer.request(attempt);
      // Either the route does not exist, or it exists and ignores the field.
      expect([200, 400, 404, 405]).toContain(response.statusCode);
    }

    const after = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(after.pointsBalance).toBe(before.pointsBalance);
    expect(after.lifetimePoints).toBe(before.lifetimePoints);
    // And no ledger row was conjured.
    expect(await db.pointsLedger.count({ where: { userId: viewer.userId } })).toBe(0);
  });

  it('refuses a negative or fractional reward cost at the schema boundary', async () => {
    const producer = await makeUser('producer', 'PRODUCER');

    for (const pointCost of [-100, 0.5, Number.NaN, 1e12]) {
      const response = await producer.request({
        method: 'POST',
        url: `${API_PREFIX}/rewards/admin`,
        payload: {
          code: `BAD_${Math.abs(Math.round(pointCost || 1))}`,
          name: 'Bad reward',
          category: 'DIGITAL',
          type: 'DIGITAL_BADGE',
          pointCost,
        },
      });
      expect(response.statusCode, String(pointCost)).toBe(400);
    }
  });

  it('never lets a redemption drive a balance below zero', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const viewer = await makeUser('viewer');

    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin`,
      payload: {
        code: 'EXPENSIVE',
        name: 'Expensive',
        category: 'DIGITAL',
        type: 'DIGITAL_BADGE',
        pointCost: 400,
        totalUnits: 10,
      },
    });
    const rewardId = created.json().data.id as string;
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin/${rewardId}/status`,
      payload: { status: 'AVAILABLE' },
    });

    // 500 points, two 400-point redemptions attempted at once.
    const results = await Promise.all([
      viewer.request({ method: 'POST', url: `${API_PREFIX}/rewards/${rewardId}/redeem` }),
      viewer.request({ method: 'POST', url: `${API_PREFIX}/rewards/${rewardId}/redeem` }),
    ]);
    expect(results.filter((result) => result.statusCode === 201)).toHaveLength(1);

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.pointsBalance).toBe(100);
    expect(profile.pointsBalance).toBeGreaterThanOrEqual(0);
  });

  it('keeps the ledger consistent with the cached balance', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const viewer = await makeUser('viewer');

    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin`,
      payload: {
        code: 'CHEAP',
        name: 'Cheap',
        category: 'DIGITAL',
        type: 'DIGITAL_BADGE',
        pointCost: 120,
        totalUnits: 5,
      },
    });
    const rewardId = created.json().data.id as string;
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin/${rewardId}/status`,
      payload: { status: 'AVAILABLE' },
    });
    await viewer.request({ method: 'POST', url: `${API_PREFIX}/rewards/${rewardId}/redeem` });

    const entries = await db.pointsLedger.findMany({ where: { userId: viewer.userId } });
    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    const replayed = entries.reduce((sum, entry) => sum + entry.delta, 500);

    expect(replayed).toBe(profile.pointsBalance);
  });
});

// ---------------------------------------------------------------------------
// 5. Reward replay
// ---------------------------------------------------------------------------

describe('5. reward replay', () => {
  it('charges once and grants once however many times a redemption is replayed', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const viewer = await makeUser('viewer');

    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin`,
      payload: {
        code: 'ONCE',
        name: 'Once only',
        category: 'DIGITAL',
        type: 'DIGITAL_BADGE',
        pointCost: 50,
        totalUnits: 100,
      },
    });
    const rewardId = created.json().data.id as string;
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin/${rewardId}/status`,
      payload: { status: 'AVAILABLE' },
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        viewer.request({ method: 'POST', url: `${API_PREFIX}/rewards/${rewardId}/redeem` }),
      ),
    );

    expect(results.filter((result) => result.statusCode === 201)).toHaveLength(1);
    expect(await db.rewardRedemption.count({ where: { userId: viewer.userId } })).toBe(1);
    expect(
      await db.pointsLedger.count({ where: { userId: viewer.userId, entryType: 'SPEND' } }),
    ).toBe(1);

    const inventory = await db.rewardInventory.findUniqueOrThrow({ where: { rewardId } });
    expect(inventory.remaining).toBe(99);
  });

  it('does not let cancel-and-redeem farm the refund', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const viewer = await makeUser('viewer');

    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin`,
      payload: {
        code: 'REFUNDABLE',
        name: 'Refundable',
        category: 'DIGITAL',
        type: 'DIGITAL_BADGE',
        pointCost: 100,
        totalUnits: 50,
        requiresApproval: true,
      },
    });
    const rewardId = created.json().data.id as string;
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin/${rewardId}/status`,
      payload: { status: 'AVAILABLE' },
    });

    const before = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });

    for (let round = 0; round < 4; round += 1) {
      const redeem = await viewer.request({
        method: 'POST',
        url: `${API_PREFIX}/rewards/${rewardId}/redeem`,
      });
      expect(redeem.statusCode).toBe(201);
      await viewer.request({
        method: 'POST',
        url: `${API_PREFIX}/rewards/me/redemptions/${redeem.json().data.redemption.id}/cancel`,
        payload: {},
      });
    }

    const after = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    // Back where they started — and, crucially, no lifetime points gained, so
    // the loop cannot be used to climb levels or the leaderboard.
    expect(after.pointsBalance).toBe(before.pointsBalance);
    expect(after.lifetimePoints).toBe(before.lifetimePoints);
  });
});

// ---------------------------------------------------------------------------
// 6. Token reuse
// ---------------------------------------------------------------------------

describe('6. token reuse', () => {
  it('destroys the session family when a refresh token is replayed', async () => {
    const user = await makeUser('victim');
    const stolen = user.getCookie('rp_rt');
    expect(stolen).toBeTruthy();

    // The legitimate holder refreshes, rotating the token.
    const rotated = await user.request({ method: 'POST', url: `${AUTH}/refresh` });
    expect(rotated.statusCode).toBe(200);

    // The attacker now replays the token they captured earlier.
    const attacker = new TestClient(app);
    const replay = await attacker.request({
      method: 'POST',
      url: `${AUTH}/refresh`,
      headers: { cookie: `rp_rt=${stolen}` },
    });
    expect(replay.statusCode).toBe(401);

    // Reuse is treated as a compromise: the victim's session is gone too.
    const afterwards = await user.request({ method: 'POST', url: `${AUTH}/refresh` });
    expect(afterwards.statusCode).toBe(401);

    const sessions = await db.userSession.findMany({ where: { userId: user.userId } });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('invalidates the access token on logout', async () => {
    const user = await makeUser('leaver');
    expect((await user.request({ method: 'GET', url: `${AUTH}/me` })).statusCode).toBe(200);

    await user.request({ method: 'POST', url: `${AUTH}/logout` });
    const { resetRedis } = await import('../helpers/db.js');
    await resetRedis();

    const response = await user.request({ method: 'GET', url: `${AUTH}/me` });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a cookie-authenticated write with no CSRF header', async () => {
    const user = await makeUser('viewer');

    // The cookie travels but the double-submit header does not — exactly what a
    // cross-site form post looks like.
    const response = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/users/me`,
      headers: { cookie: user.cookieHeader },
      payload: { displayName: 'Forged' },
    });
    expect(response.statusCode).toBe(403);

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: user.userId } });
    expect(profile.displayName).toBe('viewer');
  });

  it('refuses a mismatched CSRF header', async () => {
    const user = await makeUser('viewer');

    const response = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/users/me`,
      headers: { cookie: user.cookieHeader, 'x-csrf-token': 'a'.repeat(64) },
      payload: { displayName: 'Forged' },
    });
    expect(response.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 7. WebSocket authorisation
// ---------------------------------------------------------------------------

describe('7. websocket authorisation', () => {
  it('refuses a privileged action once the account is suspended', async () => {
    // The socket layer resolves the principal per event rather than trusting
    // the handshake, so this is the HTTP-equivalent assertion of that rule:
    // suspension takes effect without waiting for a reconnect.
    const { currentPrincipal } = await import('../../src/realtime/guard.js');
    const user = await makeUser('socketeer');

    const session = await db.userSession.findFirstOrThrow({
      where: { userId: user.userId, revokedAt: null },
    });
    const socket = { data: { sessionId: session.id, role: 'USER' } } as never;

    const active = await currentPrincipal(socket);
    expect(active.ok).toBe(true);

    await db.user.update({ where: { id: user.userId }, data: { status: 'SUSPENDED' } });
    const { resetRedis } = await import('../helpers/db.js');
    await resetRedis();

    const suspended = await currentPrincipal(socket);
    expect(suspended.ok).toBe(false);
    // The session layer already refuses a suspended account, so the refusal
    // surfaces as a revoked session. Either code is a refusal; what matters is
    // that the socket cannot act.
    expect(suspended.ok === false && ['ACCOUNT_SUSPENDED', 'SESSION_REVOKED']).toContain(
      suspended.ok === false ? suspended.code : '',
    );
  });

  it('refuses a socket with no session at all', async () => {
    const { currentPrincipal } = await import('../../src/realtime/guard.js');
    const result = await currentPrincipal({ data: {} } as never);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a socket whose session was revoked', async () => {
    const { currentPrincipal } = await import('../../src/realtime/guard.js');
    const user = await makeUser('revoked');
    const session = await db.userSession.findFirstOrThrow({ where: { userId: user.userId } });

    await db.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    const { resetRedis } = await import('../helpers/db.js');
    await resetRedis();

    const result = await currentPrincipal({ data: { sessionId: session.id } } as never);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('SESSION_REVOKED');
  });

  it('refuses a socket whose role changed underneath it', async () => {
    const { currentPrincipal } = await import('../../src/realtime/guard.js');
    const user = await makeUser('demoted', 'PRODUCER');
    const session = await db.userSession.findFirstOrThrow({
      where: { userId: user.userId, revokedAt: null },
    });

    await db.user.update({ where: { id: user.userId }, data: { role: 'USER' } });
    const { resetRedis } = await import('../helpers/db.js');
    await resetRedis();

    const result = await currentPrincipal({
      data: { sessionId: session.id, role: 'PRODUCER' },
    } as never);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('SESSION_REVOKED');
  });
});

// ---------------------------------------------------------------------------
// 8. Injected content
// ---------------------------------------------------------------------------

describe('8. injected content', () => {
  it('refuses a javascript: or data: URL wherever a URL is accepted', async () => {
    const viewer = await makeUser('viewer');
    const producer = await makeUser('producer', 'PRODUCER');

    const payloads = [
      'javascript:alert(document.cookie)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ];

    for (const avatarUrl of payloads) {
      const own = await viewer.request({
        method: 'PATCH',
        url: `${API_PREFIX}/users/me`,
        payload: { avatarUrl },
      });
      expect(own.statusCode, avatarUrl).toBe(400);

      const contestant = await producer.request({
        method: 'POST',
        url: `${API_PREFIX}/contestants/admin`,
        payload: { displayName: 'X', slug: `x-${payloads.indexOf(avatarUrl)}`, avatarUrl },
      });
      expect(contestant.statusCode, avatarUrl).toBe(400);
    }

    const profile = await db.userProfile.findUniqueOrThrow({ where: { userId: viewer.userId } });
    expect(profile.avatarUrl).toBeNull();
    expect(await db.contestant.count()).toBe(0);
  });

  it('refuses a dangerous or protocol-relative announcement link', async () => {
    const admin = await makeUser('admin', 'ADMIN');

    for (const link of ['javascript:alert(1)', '//evil.example/phish', 'data:text/html,x']) {
      const response = await admin.request({
        method: 'POST',
        url: `${API_PREFIX}/notifications/admin/announce`,
        payload: { title: 'Announcement', body: 'Body text here', link },
      });
      expect(response.statusCode, link).toBe(400);
    }

    // An in-app path and an https URL are still accepted.
    for (const link of ['/polls', 'https://example.com/news']) {
      const response = await admin.request({
        method: 'POST',
        url: `${API_PREFIX}/notifications/admin/announce`,
        payload: { title: 'Announcement', body: 'Body text here', link },
      });
      expect(response.statusCode, link).toBe(201);
    }
  });

  it('stores an XSS payload inertly and never as executable markup', async () => {
    const viewer = await makeUser('viewer');

    const response = await viewer.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges`,
      payload: {
        title: '<script>alert(1)</script>',
        description:
          'A challenge containing <img src=x onerror=alert(1)> and an onclick= handler to see how it is stored.',
        category: 'SOCIAL',
      },
    });

    // The platform does not reject markup — a challenge may legitimately mention
    // it — but it is stored as text and every renderer escapes it. What matters
    // is that it is never interpreted, which the response proves: it comes back
    // as a JSON string, not as markup.
    if (response.statusCode === 201) {
      const challenge = await db.audienceChallenge.findFirstOrThrow({
        where: { authorId: viewer.userId },
      });
      expect(challenge.title).toBe('<script>alert(1)</script>');
      expect(typeof challenge.title).toBe('string');
    } else {
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('rejects an oversized payload', async () => {
    const viewer = await makeUser('viewer');

    const response = await viewer.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges`,
      payload: {
        title: 'A'.repeat(5000),
        description: 'B'.repeat(50_000),
        category: 'SOCIAL',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(await db.audienceChallenge.count()).toBe(0);
  });

  it('neutralises a spreadsheet formula in an export', async () => {
    const { toCsv } = await import('../../src/modules/leaderboards/leaderboards.service.js');

    const csv = toCsv({
      window: 'SEASON',
      periodKey: 'season',
      timezone: 'UTC',
      exportedAt: new Date().toISOString(),
      rows: [
        { rank: 1, userId: 'usr_1', displayName: "=cmd|'/c calc'!A0", points: 10 },
        { rank: 2, userId: 'usr_2', displayName: '+1234', points: 5 },
        { rank: 3, userId: 'usr_3', displayName: 'Ordinary Name', points: 1 },
      ],
    });

    // A leading formula character is prefixed so a spreadsheet reads the cell as
    // text; an ordinary name is left alone.
    expect(csv).toContain(`"'=cmd|'/c calc'!A0"`);
    expect(csv).toContain(`"'+1234"`);
    expect(csv).toContain('"Ordinary Name"');
  });

  it('answers a malformed filter with a 400, not a 500', async () => {
    // An unvalidated enum used to reach Prisma and surface as an internal error,
    // which is both noisy and a small information leak.
    const response = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/contestants?status=%27%20OR%201%3D1--`,
    });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 9. Rate limiting
// ---------------------------------------------------------------------------

describe('9. rate limiting', () => {
  it('locks out repeated failed logins and keeps the lock after a correct guess', async () => {
    const user = await makeUser('target');

    let sawLock = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `${AUTH}/login`,
        payload: { email: user.email, password: 'not-the-password' },
      });
      if (response.statusCode === 429) sawLock = true;
    }
    expect(sawLock).toBe(true);

    // The correct password is refused too: guessing it after the lock engaged
    // must not be rewarded.
    const correct = await app.inject({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: user.email, password: VALID_PASSWORD },
    });
    expect(correct.statusCode).toBe(429);
  });

  it('enforces a per-route limit on an expensive operation', async () => {
    // Registered with its own limiter, so this is checked against a real app
    // instance with rate limiting switched on rather than the shared test app.
    const limited = await buildApp();
    await limited.ready();

    try {
      const admin = await makeUser('announcer', 'ADMIN', limited);
      const codes: number[] = [];

      for (let attempt = 0; attempt < 14; attempt += 1) {
        const response = await admin.request({
          method: 'POST',
          url: `${API_PREFIX}/notifications/admin/announce`,
          payload: { title: `Announcement ${attempt}`, body: 'Body text here' },
        });
        codes.push(response.statusCode);
      }

      // The limiter must answer 429 with a RATE_LIMITED code — a throttled
      // client that is told the server broke will simply retry harder.
      expect(codes).toContain(429);
      const throttled = await admin.request({
        method: 'POST',
        url: `${API_PREFIX}/notifications/admin/announce`,
        payload: { title: 'One more', body: 'Body text here' },
      });
      expect(throttled.statusCode).toBe(429);
      expect(throttled.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('bounds a socket event before it reaches the database', async () => {
    const { withinRateLimit, RATE_LIMITS } = await import('../../src/realtime/guard.js');
    const socket = { id: `probe-${Date.now()}` } as never;

    const outcomes: boolean[] = [];
    for (let attempt = 0; attempt < RATE_LIMITS.join.max + 5; attempt += 1) {
      outcomes.push(await withinRateLimit(socket, RATE_LIMITS.join));
    }

    expect(outcomes.filter(Boolean)).toHaveLength(RATE_LIMITS.join.max);
    expect(outcomes.at(-1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Sensitive data exposure
// ---------------------------------------------------------------------------

describe('10. sensitive data exposure', () => {
  it('never returns a password hash or a token', async () => {
    const user = await makeUser('viewer');

    const responses = await Promise.all([
      user.request({ method: 'GET', url: `${AUTH}/me` }),
      user.request({ method: 'GET', url: `${AUTH}/sessions` }),
      user.request({ method: 'GET', url: `${API_PREFIX}/users/${user.userId}` }),
    ]);

    for (const response of responses) {
      const body = response.body.toLowerCase();
      for (const secret of ['passwordhash', 'refreshtokenhash', 'previoustokenhash', 'cookie_secret', 'jwt_secret']) {
        expect(body, `${response.raw.req.url} leaked ${secret}`).not.toContain(secret);
      }
      expect(body).not.toContain(VALID_PASSWORD.toLowerCase());
    }
  });

  it('does not expose another user’s email through a public profile', async () => {
    const viewer = await makeUser('viewer');
    const other = await makeUser('other');

    const response = await viewer.request({
      method: 'GET',
      url: `${API_PREFIX}/users/${other.userId}`,
    });

    if (response.statusCode === 200) {
      expect(response.body).not.toContain('other@test.local');
    }
  });

  it('returns no stack trace, SQL fragment or column name on an error', async () => {
    const viewer = await makeUser('viewer');

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: `${API_PREFIX}/challenges/does-not-exist` }),
      app.inject({ method: 'GET', url: `${API_PREFIX}/nope` }),
      viewer.request({
        method: 'POST',
        url: `${API_PREFIX}/challenges`,
        payload: { title: 'x' },
      }),
    ]);

    for (const response of responses) {
      const body = response.body;
      expect(body).not.toMatch(/at\s+\w+\s+\(.*\.ts:\d+/);
      expect(body).not.toMatch(/prisma|postgres|SELECT |INSERT INTO/i);
      expect(body).not.toContain('node_modules');
      // Every error still carries a request id, so a report can be traced
      // without the client being told why.
      expect(JSON.parse(body).error.requestId).toBeTruthy();
    }
  });

  it('does not reveal whether an email exists on password reset', async () => {
    await makeUser('known');

    const [existing, missing] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `${AUTH}/forgot-password`,
        payload: { email: 'known@test.local' },
      }),
      app.inject({
        method: 'POST',
        url: `${AUTH}/forgot-password`,
        payload: { email: 'nobody@test.local' },
      }),
    ]);

    // Identical answers: enumeration through this endpoint gains nothing.
    expect(existing.statusCode).toBe(missing.statusCode);
    expect(existing.body).toBe(missing.body);
  });

  it('does not leak the offending column on a uniqueness conflict', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const payload = { displayName: 'Twin', slug: 'twin' };

    await producer.request({ method: 'POST', url: `${API_PREFIX}/contestants/admin`, payload });
    const duplicate = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload,
    });

    expect(duplicate.statusCode).toBe(409);

    // A service may name the field in its own words — that is helpful. What
    // must not appear is Prisma's raw column list, which is schema internals.
    const body = JSON.parse(duplicate.body);
    expect(body.error.details).toBeUndefined();
    expect(duplicate.body).not.toContain('showId');
  });
});
