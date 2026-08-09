import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const NOMINATIONS = `${API_PREFIX}/nominations`;
const EVICTIONS = `${API_PREFIX}/evictions`;

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
  role: 'USER' | 'PRODUCER' | 'ADMIN' = 'USER',
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

const CONTESTANT_IDS = ['con_a', 'con_b', 'con_c', 'con_d'];

beforeEach(async () => {
  await resetAll();

  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.pointsRule.createMany({
    data: [
      { key: 'NOMINATION_PARTICIPATION', points: 4 },
      { key: 'EVICTION_PARTICIPATION', points: 4 },
    ],
  });
  await db.contestant.createMany({
    data: CONTESTANT_IDS.map((id, index) => ({
      id,
      showId: 'show_test',
      slug: id.replace('_', '-'),
      displayName: `Contestant ${String.fromCharCode(65 + index)}`,
    })),
  });
});

async function seedOpenRound(
  type: 'nomination' | 'eviction',
  options: { maxVotesPerUser?: number; closesInMs?: number } = {},
) {
  const data = {
    id: `${type}_round`,
    showId: 'show_test',
    title: `Test ${type} round`,
    status: 'OPEN' as const,
    opensAt: new Date(Date.now() - 60_000),
    closesAt: new Date(Date.now() + (options.closesInMs ?? 3600_000)),
    maxVotesPerUser: options.maxVotesPerUser ?? 2,
    candidates: { create: CONTESTANT_IDS.map((contestantId) => ({ contestantId })) },
  };

  return type === 'nomination'
    ? db.nominationRound.create({ data })
    : db.evictionRound.create({ data: { ...data, voteMeaning: 'SAVE' } });
}

// ---------------------------------------------------------------------------

describe('vote limits', () => {
  it('lets a user spend exactly their allowance and no more', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 2 });
    const client = await makeUser('voter@test.local', 'Voter');

    const first = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.votesUsed).toBe(1);
    expect(first.json().data.votesRemaining).toBe(1);

    const second = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_b' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.votesRemaining).toBe(0);

    const third = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_c' },
    });
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe('VOTE_LIMIT_REACHED');

    expect(await db.nominationVote.count()).toBe(2);
  });

  it('honours a limit of one', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 1 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    const second = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_b' },
    });

    expect(second.statusCode).toBe(409);
    expect(await db.nominationVote.count()).toBe(1);
  });

  it('never exceeds the limit under concurrent requests', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 2 });
    const client = await makeUser('racer@test.local', 'Racer');

    // Four votes fired at once against an allowance of two.
    const responses = await Promise.all(
      CONTESTANT_IDS.map((contestantId) =>
        client.request({
          method: 'POST',
          url: `${NOMINATIONS}/nomination_round/votes`,
          payload: { contestantId },
        }),
      ),
    );

    const accepted = responses.filter((response) => response.statusCode === 200);
    const rejected = responses.filter((response) => response.statusCode === 409);

    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.json().error.code === 'VOTE_LIMIT_REACHED')).toBe(true);

    // The decisive assertion: stored state matches what clients were told.
    expect(await db.nominationVote.count()).toBe(2);
    const allowance = await db.roundVoteAllowance.findFirstOrThrow();
    expect(allowance.votesUsed).toBe(2);

    const round = await db.nominationRound.findUniqueOrThrow({ where: { id: 'nomination_round' } });
    expect(round.totalVotes).toBe(2);
  });

  it('refuses a second vote for the same contestant without spending an allowance', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 3 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    const duplicate = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('VOTE_DUPLICATE');

    // The rejected duplicate must not have cost the user one of their votes.
    const allowance = await db.roundVoteAllowance.findFirstOrThrow();
    expect(allowance.votesUsed).toBe(1);

    const remaining = await client.request({
      method: 'GET',
      url: `${NOMINATIONS}/nomination_round`,
    });
    expect(remaining.json().data.votesRemaining).toBe(2);
  });

  it('returns a vote to the allowance when it is withdrawn', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 1 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    const withdrawn = await client.request({
      method: 'DELETE',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().data.votesRemaining).toBe(1);

    const recast = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_b' },
    });
    expect(recast.statusCode).toBe(200);
    expect(await db.nominationVote.count()).toBe(1);
  });

  it('tracks allowances separately per user and per round', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 1 });
    await seedOpenRound('eviction', { maxVotesPerUser: 1 });

    const one = await makeUser('one@test.local', 'One');
    const two = await makeUser('two@test.local', 'Two');

    await one.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    // A different user is unaffected…
    const otherUser = await two.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    expect(otherUser.statusCode).toBe(200);

    // …and so is the same user in the *other* round.
    const otherRound = await one.request({
      method: 'POST',
      url: `${EVICTIONS}/eviction_round/votes`,
      payload: { contestantId: 'con_b' },
    });
    expect(otherRound.statusCode).toBe(200);

    expect(await db.roundVoteAllowance.count()).toBe(3);
  });

  it('applies a raised limit to a user who was already at the old one', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 1 });
    const client = await makeUser('voter@test.local', 'Voter');

    await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    const blocked = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_b' },
    });
    expect(blocked.statusCode).toBe(409);

    await db.nominationRound.update({
      where: { id: 'nomination_round' },
      data: { maxVotesPerUser: 3 },
    });

    const allowed = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_b' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.votesRemaining).toBe(1);
  });
});

describe('round gating', () => {
  it('refuses a vote before the round opens', async () => {
    await db.nominationRound.create({
      data: {
        id: 'nomination_round',
        showId: 'show_test',
        title: 'Not yet',
        status: 'OPEN',
        opensAt: new Date(Date.now() + 60_000),
        closesAt: new Date(Date.now() + 120_000),
        maxVotesPerUser: 1,
        candidates: { create: CONTESTANT_IDS.map((contestantId) => ({ contestantId })) },
      },
    });

    const client = await makeUser('voter@test.local', 'Voter');
    const response = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/not opened yet/i);
  });

  it('refuses a vote after the deadline, even while the status still says OPEN', async () => {
    await seedOpenRound('nomination', { closesInMs: -1000 });
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ROUND_CLOSED');
    expect(await db.nominationVote.count()).toBe(0);
  });

  it('refuses a vote for an ineligible contestant', async () => {
    await seedOpenRound('nomination');
    await db.nominationCandidate.update({
      where: { roundId_contestantId: { roundId: 'nomination_round', contestantId: 'con_a' } },
      data: { eligible: false },
    });

    const client = await makeUser('voter@test.local', 'Voter');
    const response = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_ELIGIBLE');
  });

  it('refuses a vote for a contestant who is not in the round', async () => {
    await seedOpenRound('nomination');
    const client = await makeUser('voter@test.local', 'Voter');

    const response = await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_not_here' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('hides the live standings until the round is published', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 1 });
    const voter = await makeUser('voter@test.local', 'Voter');
    await voter.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });

    const view = (await voter.request({ method: 'GET', url: `${NOMINATIONS}/nomination_round` }))
      .json().data;

    // Participation volume is public — it sways nobody toward a contestant.
    expect(view.totalVotes).toBe(1);
    // Per-candidate standings are not, until the round is published.
    expect(view.candidates.every((c: { voteCount: number }) => c.voteCount === 0)).toBe(true);
    expect(view.candidates.every((c: { percentage: number }) => c.percentage === 0)).toBe(true);
    // But the user can still see which contestant they backed.
    expect(view.candidates.find((c: { contestantId: string }) => c.contestantId === 'con_a').votedByMe).toBe(
      true,
    );
  });
});

describe('audience result versus official outcome', () => {
  it('keeps them in separate columns, published by separate actions', async () => {
    await seedOpenRound('eviction', { maxVotesPerUser: 1 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    for (const index of [1, 2, 3]) {
      const voter = await makeUser(`voter${index}@test.local`, `Voter${index}`);
      await voter.request({
        method: 'POST',
        url: `${EVICTIONS}/eviction_round/votes`,
        payload: { contestantId: index === 3 ? 'con_b' : 'con_a' },
      });
    }

    await producer.request({ method: 'POST', url: `${EVICTIONS}/admin/eviction_round/close` });
    await producer.request({
      method: 'POST',
      url: `${EVICTIONS}/admin/eviction_round/publish-audience-result`,
    });

    const afterAudience = await db.evictionRound.findUniqueOrThrow({
      where: { id: 'eviction_round' },
    });

    expect(afterAudience.status).toBe('PUBLISHED');
    expect(afterAudience.audienceResult).toBeTruthy();
    // Publishing the audience view must not touch the official outcome.
    expect(afterAudience.officialOutcome).toBeNull();
    expect(afterAudience.officialPublishedAt).toBeNull();

    const audience = afterAudience.audienceResult as {
      kind: string;
      disclaimer: string;
      standings: { contestantId: string; rank: number }[];
    };
    expect(audience.kind).toBe('AUDIENCE_RESULT');
    expect(audience.disclaimer).toMatch(/not the official show outcome/i);
    expect(audience.standings[0]!.contestantId).toBe('con_a');

    // The official outcome is a separate, deliberate action — and it does not
    // have to agree with the audience.
    await producer.request({
      method: 'POST',
      url: `${EVICTIONS}/admin/eviction_round/publish-official-outcome`,
      payload: { contestantIds: ['con_d'], note: 'Announced live on air' },
    });

    const afterOfficial = await db.evictionRound.findUniqueOrThrow({
      where: { id: 'eviction_round' },
    });
    const official = afterOfficial.officialOutcome as {
      kind: string;
      source: string;
      contestants: { id: string }[];
    };

    expect(official.kind).toBe('OFFICIAL_OUTCOME');
    expect(official.source).toBe('production');
    expect(official.contestants[0]!.id).toBe('con_d');
    // The audience record is untouched by the official announcement.
    expect(afterOfficial.audienceResult).toEqual(afterAudience.audienceResult);
  });

  it('always sends the disclaimer with a round, published or not', async () => {
    await seedOpenRound('eviction');
    const response = await app.inject({ method: 'GET', url: `${EVICTIONS}/eviction_round` });
    expect(response.json().data.disclaimer).toMatch(/not the official show outcome/i);
  });

  it('refuses the official outcome to a producer without the permission', async () => {
    await seedOpenRound('eviction');
    const moderator = await makeUser('mod@test.local', 'Mod');

    const response = await moderator.request({
      method: 'POST',
      url: `${EVICTIONS}/admin/eviction_round/publish-official-outcome`,
      payload: { contestantIds: ['con_a'] },
    });

    expect(response.statusCode).toBe(403);
  });

  it('records audience nominations separately from official ones', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 1 });
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    for (const index of [1, 2]) {
      const voter = await makeUser(`voter${index}@test.local`, `Voter${index}`);
      await voter.request({
        method: 'POST',
        url: `${NOMINATIONS}/nomination_round/votes`,
        payload: { contestantId: index === 1 ? 'con_a' : 'con_b' },
      });
    }

    await producer.request({ method: 'POST', url: `${NOMINATIONS}/admin/nomination_round/close` });
    await producer.request({
      method: 'POST',
      url: `${NOMINATIONS}/admin/nomination_round/publish-audience-result`,
    });
    await producer.request({
      method: 'POST',
      url: `${NOMINATIONS}/admin/nomination_round/publish-official-outcome`,
      payload: { contestantIds: ['con_c'] },
    });

    const nominations = await db.nomination.findMany({ orderBy: { source: 'asc' } });
    const bySource = Object.fromEntries(
      nominations.map((row) => [`${row.source}:${row.contestantId}`, true]),
    );

    expect(bySource['AUDIENCE:con_a']).toBe(true);
    expect(bySource['AUDIENCE:con_b']).toBe(true);
    expect(bySource['OFFICIAL:con_c']).toBe(true);
    // The official nomination is not silently attributed to the audience.
    expect(bySource['AUDIENCE:con_c']).toBeUndefined();
  });
});

describe('operator lifecycle and audit', () => {
  it('refuses every operator action to an ordinary user', async () => {
    await seedOpenRound('nomination');
    const client = await makeUser('voter@test.local', 'Voter');

    for (const path of ['open', 'close', 'publish-audience-result']) {
      const response = await client.request({
        method: 'POST',
        url: `${NOMINATIONS}/admin/nomination_round/${path}`,
      });
      expect(response.statusCode, path).toBe(403);
    }
  });

  it('creates, opens, closes and audits a round', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const created = await producer.request({
      method: 'POST',
      url: `${NOMINATIONS}/admin`,
      payload: {
        title: 'Week 13 nominations',
        opensAt: new Date(Date.now() - 1000).toISOString(),
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        maxVotesPerUser: 2,
        contestantIds: CONTESTANT_IDS,
      },
    });
    expect(created.statusCode).toBe(201);
    const roundId = created.json().data.id;

    // A draft is invisible to viewers.
    expect(
      (await app.inject({ method: 'GET', url: `${NOMINATIONS}/${roundId}` })).statusCode,
    ).toBe(404);

    await producer.request({ method: 'POST', url: `${NOMINATIONS}/admin/${roundId}/open` });
    expect(
      (await app.inject({ method: 'GET', url: `${NOMINATIONS}/${roundId}` })).statusCode,
    ).toBe(200);

    await producer.request({ method: 'POST', url: `${NOMINATIONS}/admin/${roundId}/close` });

    const audit = await db.auditLog.findMany({ where: { entityType: 'NOMINATIONRound' } });
    const actions = audit.map((row) => row.action).sort();
    expect(actions).toEqual(['nomination.close', 'nomination.create', 'nomination.open']);
  });

  it('refuses to create a round with fewer than two contestants', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${NOMINATIONS}/admin`,
      payload: {
        title: 'Too small',
        opensAt: new Date().toISOString(),
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        contestantIds: ['con_a'],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('lets a producer mark a contestant ineligible mid-round', async () => {
    await seedOpenRound('nomination');
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'PATCH',
      url: `${NOMINATIONS}/admin/nomination_round/eligibility`,
      payload: { contestantId: 'con_a', eligible: false },
    });
    expect(response.statusCode).toBe(200);

    const voter = await makeUser('voter@test.local', 'Voter');
    const blocked = await voter.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    expect(blocked.json().error.code).toBe('NOT_ELIGIBLE');
  });
});

describe('weighted voting', () => {
  it('applies a per-contestant multiplier to the weighted score only', async () => {
    await db.nominationRound.create({
      data: {
        id: 'nomination_round',
        showId: 'show_test',
        title: 'Weighted round',
        status: 'OPEN',
        opensAt: new Date(Date.now() - 1000),
        closesAt: new Date(Date.now() + 3600_000),
        maxVotesPerUser: 2,
        weighting: { con_a: 2.5 },
        candidates: { create: CONTESTANT_IDS.map((contestantId) => ({ contestantId })) },
      },
    });

    const client = await makeUser('voter@test.local', 'Voter');
    await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_a' },
    });
    await client.request({
      method: 'POST',
      url: `${NOMINATIONS}/nomination_round/votes`,
      payload: { contestantId: 'con_b' },
    });

    const weighted = await db.nominationCandidate.findUniqueOrThrow({
      where: { roundId_contestantId: { roundId: 'nomination_round', contestantId: 'con_a' } },
    });
    const plain = await db.nominationCandidate.findUniqueOrThrow({
      where: { roundId_contestantId: { roundId: 'nomination_round', contestantId: 'con_b' } },
    });

    // Head count stays honest; only the weighted score reflects the multiplier.
    expect(weighted.voteCount).toBe(1);
    expect(weighted.weightedScore).toBe(2.5);
    expect(plain.voteCount).toBe(1);
    expect(plain.weightedScore).toBe(1);
  });
});

describe('points', () => {
  it('credits participation once per round, not once per vote', async () => {
    await seedOpenRound('nomination', { maxVotesPerUser: 3 });
    const client = await makeUser('voter@test.local', 'Voter');

    for (const contestantId of ['con_a', 'con_b', 'con_c']) {
      await client.request({
        method: 'POST',
        url: `${NOMINATIONS}/nomination_round/votes`,
        payload: { contestantId },
      });
    }

    const ledger = await db.pointsLedger.findMany({ where: { sourceId: 'nomination_round' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.delta).toBe(4);

    const profile = await db.userProfile.findFirstOrThrow({ where: { displayName: 'Voter' } });
    expect(profile.pointsBalance).toBe(4);
  });
});
