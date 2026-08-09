import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const CHALLENGES = `${API_PREFIX}/challenges`;

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

const GOOD_CHALLENGE = {
  title: 'Silent breakfast',
  description:
    'The house must prepare and eat breakfast together without speaking a single word to each other.',
  category: 'MENTAL' as const,
  targetType: 'HOUSE' as const,
};

beforeEach(async () => {
  await resetAll();
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.pointsRule.createMany({
    data: [
      { key: 'CHALLENGE_SUBMISSION', points: 10 },
      { key: 'CHALLENGE_APPROVED', points: 15 },
      { key: 'CHALLENGE_TOP3', points: 75 },
      { key: 'CHALLENGE_SELECTED', points: 200 },
    ],
  });
});

/**
 * Drives a challenge from creation to community voting through the real routes.
 *
 * `staff` must be a PRODUCER: approving is a moderator action, but opening
 * community voting needs `challenge.cycle.manage`, which only producers hold.
 */
async function challengeInVoting(author: TestClient, staff: TestClient, overrides = {}) {
  const created = await author.request({
    method: 'POST',
    url: CHALLENGES,
    payload: { ...GOOD_CHALLENGE, ...overrides },
  });
  const id = created.json().data.id as string;

  await staff.request({
    method: 'POST',
    url: `${CHALLENGES}/admin/${id}/moderate`,
    payload: { decision: 'APPROVE' },
  });
  await staff.request({
    method: 'POST',
    url: `${CHALLENGES}/admin/${id}/open-voting`,
    payload: {},
  });

  return id;
}

// ---------------------------------------------------------------------------

describe('creating a challenge', () => {
  it('creates it in moderation and credits submission points', async () => {
    const author = await makeUser('author@test.local', 'Author');

    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });

    expect(response.statusCode).toBe(201);
    const challenge = response.json().data;
    expect(challenge.status).toBe('MODERATION');
    expect(challenge.isOwn).toBe(true);
    expect(challenge.canVote).toBe(false);

    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Author' } });
    expect(profile.pointsBalance).toBe(10);
  });

  it('refuses abusive content with a clear reason', async () => {
    const author = await makeUser('author@test.local', 'Author');

    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: { ...GOOD_CHALLENGE, description: 'Make that idiot eat shit on live television' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CONTENT_REJECTED');
    expect(await db.audienceChallenge.count()).toBe(0);
  });

  it('refuses anything that would deprive a contestant', async () => {
    const author = await makeUser('author@test.local', 'Author');

    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: {
        ...GOOD_CHALLENGE,
        description: 'Make the whole house go without water for a full day and see who breaks.',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(await db.audienceChallenge.count()).toBe(0);
  });

  it('accepts a spam-flagged submission but escalates it for a human', async () => {
    const author = await makeUser('author@test.local', 'Author');

    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: {
        ...GOOD_CHALLENGE,
        description: 'Great idea here, see https://example.com and email me at me@example.com now.',
      },
    });

    expect(response.statusCode).toBe(201);
    const stored = await db.audienceChallenge.findFirstOrThrow();
    expect(stored.status).toBe('MODERATION');
    expect(stored.moderationStatus).toBe('ESCALATED');
    expect(stored.moderationNotes).toContain('contains-link');
  });

  it('saves a draft without sending it to moderation or paying points', async () => {
    const author = await makeUser('author@test.local', 'Author');

    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: { ...GOOD_CHALLENGE, submit: false },
    });

    expect(response.json().data.status).toBe('DRAFT');
    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Author' } });
    expect(profile.pointsBalance).toBe(0);
  });

  it('requires a contestant when the challenge targets one', async () => {
    const author = await makeUser('author@test.local', 'Author');

    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: { ...GOOD_CHALLENGE, targetType: 'CONTESTANT' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('stops a user flooding the queue', async () => {
    const author = await makeUser('author@test.local', 'Author');

    for (let index = 0; index < 5; index += 1) {
      const response = await author.request({
        method: 'POST',
        url: CHALLENGES,
        payload: { ...GOOD_CHALLENGE, title: `Silent breakfast number ${index}` },
      });
      expect(response.statusCode).toBe(201);
    }

    const sixth = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: { ...GOOD_CHALLENGE, title: 'One challenge too many' },
    });
    expect(sixth.statusCode).toBe(429);
  });

  it('requires a confirmed email', async () => {
    const author = await makeUser('unverified@test.local', 'Unverified', 'USER', false);
    const response = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('moderation gate', () => {
  it('keeps an unmoderated challenge out of the public feed', async () => {
    const author = await makeUser('author@test.local', 'Author');
    await author.request({ method: 'POST', url: CHALLENGES, payload: GOOD_CHALLENGE });

    const feed = await app.inject({ method: 'GET', url: `${CHALLENGES}?scope=all` });
    expect(feed.json().data.items).toHaveLength(0);
  });

  it('hides another user’s pending challenge but shows it to its author', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const stranger = await makeUser('stranger@test.local', 'Stranger');

    const created = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    const id = created.json().data.id;

    expect((await stranger.request({ method: 'GET', url: `${CHALLENGES}/${id}` })).statusCode).toBe(
      404,
    );
    expect((await author.request({ method: 'GET', url: `${CHALLENGES}/${id}` })).statusCode).toBe(
      200,
    );
  });

  it('refuses moderation to an ordinary user', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const created = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    const id = created.json().data.id;

    const response = await author.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/moderate`,
      payload: { decision: 'APPROVE' },
    });
    expect(response.statusCode).toBe(403);

    const queue = await author.request({ method: 'GET', url: `${CHALLENGES}/admin/queue` });
    expect(queue.statusCode).toBe(403);
  });

  it('lets a moderator approve, which credits the author and writes a decision record', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const moderator = await makeUser('mod@test.local', 'Mod', 'MODERATOR');

    const created = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    const id = created.json().data.id;

    const response = await moderator.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/moderate`,
      payload: { decision: 'APPROVE', reason: 'Safe and original' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('APPROVED');

    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Author' } });
    expect(profile.pointsBalance).toBe(25); // 10 submission + 15 approved

    const decision = await db.moderationDecision.findFirstOrThrow();
    expect(decision.decision).toBe('APPROVED');
    expect(decision.targetId).toBe(id);

    const audit = await db.auditLog.findFirst({ where: { action: 'challenge.approve' } });
    expect(audit).toBeTruthy();
  });

  it('surfaces the moderator-only fields in the queue and nowhere else', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const moderator = await makeUser('mod@test.local', 'Mod', 'MODERATOR');
    await author.request({ method: 'POST', url: CHALLENGES, payload: GOOD_CHALLENGE });

    const queue = await moderator.request({ method: 'GET', url: `${CHALLENGES}/admin/queue` });
    const item = queue.json().data[0];

    expect(item.authorEmail).toBe('author@test.local');
    expect(item).toHaveProperty('contentFlags');
    expect(item).toHaveProperty('reportCount');

    // The public detail view must never carry the author's email.
    const created = await db.audienceChallenge.findFirstOrThrow();
    const publicView = await author.request({ method: 'GET', url: `${CHALLENGES}/${created.id}` });
    expect(publicView.body).not.toContain('author@test.local');
  });
});

describe('voting', () => {
  it('records a vote and increments the count', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const voter = await makeUser('voter@test.local', 'Voter');

    const id = await challengeInVoting(author, producer);

    const response = await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.voteCount).toBe(1);

    const stored = await db.audienceChallenge.findUniqueOrThrow({ where: { id } });
    expect(stored.voteCount).toBe(1);
  });

  it('refuses a second vote from the same user', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const voter = await makeUser('voter@test.local', 'Voter');
    const id = await challengeInVoting(author, producer);

    await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });
    const second = await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('VOTE_DUPLICATE');

    const stored = await db.audienceChallenge.findUniqueOrThrow({ where: { id } });
    expect(stored.voteCount).toBe(1);
    expect(await db.challengeVote.count({ where: { challengeId: id } })).toBe(1);
  });

  it('refuses a vote for your own challenge', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const id = await challengeInVoting(author, producer);

    const response = await author.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('SELF_VOTE_FORBIDDEN');
    expect(await db.challengeVote.count()).toBe(0);
  });

  it('refuses a vote before the challenge reaches community voting', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const voter = await makeUser('voter@test.local', 'Voter');

    const created = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    const id = created.json().data.id;

    const response = await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ROUND_CLOSED');
  });

  it('lets a voter withdraw and re-cast exactly once', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const voter = await makeUser('voter@test.local', 'Voter');
    const id = await challengeInVoting(author, producer);

    await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });
    const withdrawn = await voter.request({ method: 'DELETE', url: `${CHALLENGES}/${id}/vote` });
    expect(withdrawn.json().data.voteCount).toBe(0);

    const again = await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });
    expect(again.json().data.voteCount).toBe(1);
  });

  it('explains to each viewer why they cannot vote', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const voter = await makeUser('voter@test.local', 'Voter');
    const id = await challengeInVoting(author, producer);

    const own = (await author.request({ method: 'GET', url: `${CHALLENGES}/${id}` })).json().data;
    expect(own.voteBlockedReason).toMatch(/own challenge/i);

    await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });
    const voted = (await voter.request({ method: 'GET', url: `${CHALLENGES}/${id}` })).json().data;
    expect(voted.hasVoted).toBe(true);
    expect(voted.voteBlockedReason).toMatch(/already voted/i);

    const anonymous = (await app.inject({ method: 'GET', url: `${CHALLENGES}/${id}` })).json().data;
    expect(anonymous.voteBlockedReason).toMatch(/sign in/i);
  });
});

describe('abuse reporting', () => {
  it('records a report and refuses a duplicate from the same reporter', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const reporter = await makeUser('reporter@test.local', 'Reporter');
    const id = await challengeInVoting(author, producer);

    const first = await reporter.request({
      method: 'POST',
      url: `${CHALLENGES}/${id}/report`,
      payload: { reason: 'OFF_TOPIC', details: 'Nothing to do with the show' },
    });
    expect(first.statusCode).toBe(200);

    const second = await reporter.request({
      method: 'POST',
      url: `${CHALLENGES}/${id}/report`,
      payload: { reason: 'SPAM' },
    });
    expect(second.statusCode).toBe(409);

    const stored = await db.audienceChallenge.findUniqueOrThrow({ where: { id } });
    expect(stored.reportCount).toBe(1);
  });

  it('escalates after three independent reports without removing the challenge', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const id = await challengeInVoting(author, producer);

    for (const index of [1, 2, 3]) {
      const reporter = await makeUser(`reporter${index}@test.local`, `Reporter${index}`);
      await reporter.request({
        method: 'POST',
        url: `${CHALLENGES}/${id}/report`,
        payload: { reason: 'OFFENSIVE' },
      });
    }

    const stored = await db.audienceChallenge.findUniqueOrThrow({ where: { id } });
    expect(stored.reportCount).toBe(3);
    expect(stored.moderationStatus).toBe('ESCALATED');
    // Still visible: taking it down is a moderator's decision, not a vote.
    expect(stored.status).toBe('COMMUNITY_VOTING');
    expect(stored.deletedAt).toBeNull();
  });

  it('refuses a report of your own challenge', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const id = await challengeInVoting(author, producer);

    const response = await author.request({
      method: 'POST',
      url: `${CHALLENGES}/${id}/report`,
      payload: { reason: 'SPAM' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('production lifecycle', () => {
  it('walks the full path and pays the author at each milestone', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');
    const voter = await makeUser('voter@test.local', 'Voter');

    const cycle = await db.challengeCycle.create({
      data: {
        id: 'cycle_test',
        showId: 'show_test',
        title: 'Test cycle',
        status: 'OPEN',
        opensAt: new Date(Date.now() - 3600_000),
        closesAt: new Date(Date.now() + 3600_000),
        topN: 1,
      },
    });

    const created = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    const id = created.json().data.id;

    await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/moderate`,
      payload: { decision: 'APPROVE' },
    });
    await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/open-voting`,
      payload: { cycleId: cycle.id },
    });
    await voter.request({ method: 'POST', url: `${CHALLENGES}/${id}/vote` });

    const promoted = await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/cycles/${cycle.id}/promote`,
    });
    expect(promoted.json().data.promoted).toHaveLength(1);
    expect(promoted.json().data.promoted[0].rank).toBe(1);

    await producer.request({ method: 'POST', url: `${CHALLENGES}/admin/${id}/producer-review` });
    await producer.request({ method: 'POST', url: `${CHALLENGES}/admin/${id}/select` });
    await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/execute`,
      payload: { resultNotes: 'Ran on Thursday, the house lasted 40 minutes' },
    });
    const completed = await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/complete`,
      payload: {},
    });

    expect(completed.json().data.status).toBe('COMPLETED');
    expect(completed.json().data.resultNotes).toContain('40 minutes');

    // 10 submission + 15 approved + 75 top-3 + 200 selected
    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Author' } });
    expect(profile.pointsBalance).toBe(300);

    const ledger = await db.pointsLedger.findMany({ where: { sourceId: id } });
    expect(ledger.map((entry) => entry.reason).sort()).toEqual([
      'approved',
      'selected',
      'submission',
      'top-challenges',
    ]);
  });

  it('refuses to skip a step in the lifecycle', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const created = await author.request({
      method: 'POST',
      url: CHALLENGES,
      payload: GOOD_CHALLENGE,
    });
    const id = created.json().data.id;

    // Straight from MODERATION to SELECTED is not a legal move.
    const response = await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/select`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('promotes only the configured number of challenges', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const cycle = await db.challengeCycle.create({
      data: {
        id: 'cycle_test',
        showId: 'show_test',
        title: 'Test cycle',
        status: 'OPEN',
        opensAt: new Date(Date.now() - 3600_000),
        closesAt: new Date(Date.now() + 3600_000),
        topN: 2,
      },
    });

    const ids: string[] = [];
    for (const index of [1, 2, 3, 4]) {
      const author = await makeUser(`author${index}@test.local`, `Author${index}`);
      const created = await author.request({
        method: 'POST',
        url: CHALLENGES,
        payload: { ...GOOD_CHALLENGE, title: `Silent breakfast idea ${index}` },
      });
      const id = created.json().data.id;
      ids.push(id);

      await producer.request({
        method: 'POST',
        url: `${CHALLENGES}/admin/${id}/moderate`,
        payload: { decision: 'APPROVE' },
      });
      await producer.request({
        method: 'POST',
        url: `${CHALLENGES}/admin/${id}/open-voting`,
        payload: { cycleId: cycle.id },
      });
    }

    // Give the third challenge the most votes.
    for (const index of [1, 2, 3]) {
      const voter = await makeUser(`voter${index}@test.local`, `Voter${index}`);
      await voter.request({ method: 'POST', url: `${CHALLENGES}/${ids[2]}/vote` });
      if (index <= 2) await voter.request({ method: 'POST', url: `${CHALLENGES}/${ids[1]}/vote` });
    }

    const promoted = await producer.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/cycles/${cycle.id}/promote`,
    });

    const body = promoted.json().data;
    expect(body.promoted).toHaveLength(2);
    expect(body.promoted[0].id).toBe(ids[2]);
    expect(body.ranked).toHaveLength(4);

    const statuses = await db.audienceChallenge.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    const promotedCount = statuses.filter((row) => row.status === 'TOP_CHALLENGES').length;
    expect(promotedCount).toBe(2);
  });

  it('refuses production actions to a moderator who lacks the permission', async () => {
    const author = await makeUser('author@test.local', 'Author');
    const moderator = await makeUser('mod@test.local', 'Mod', 'MODERATOR');
    const id = await challengeInVoting(author, moderator);

    const response = await moderator.request({
      method: 'POST',
      url: `${CHALLENGES}/admin/${id}/select`,
    });
    expect(response.statusCode).toBe(403);
  });
});
