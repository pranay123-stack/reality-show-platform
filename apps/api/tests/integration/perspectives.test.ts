import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const PERSPECTIVES = `${API_PREFIX}/perspectives`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectTestDatabase();
});

async function makeUser(email: string, displayName: string, role: 'USER' | 'PRODUCER' = 'USER') {
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
  await db.pointsRule.create({ data: { key: 'PERSPECTIVE_PARTICIPATION', points: 3 } });

  await db.contestant.createMany({
    data: [
      { id: 'con_a', showId: 'show_test', slug: 'con-a', displayName: 'Contestant A' },
      { id: 'con_b', showId: 'show_test', slug: 'con-b', displayName: 'Contestant B' },
    ],
  });

  await db.event.create({
    data: {
      id: 'evt_test',
      showId: 'show_test',
      type: 'ARGUMENT',
      title: 'The kitchen argument',
      description: 'A disagreement over a missing ingredient.',
      occurredAt: new Date(Date.now() - 3600_000),
      contestants: { create: [{ contestantId: 'con_a' }, { contestantId: 'con_b' }] },
    },
  });
});

async function seedOpenPerspective(closesInMs = 3600_000) {
  return db.audiencePerspective.create({
    data: {
      id: 'persp_test',
      showId: 'show_test',
      eventId: 'evt_test',
      question: 'In the kitchen argument, who was right?',
      status: 'OPEN',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + closesInMs),
      options: {
        create: [
          { id: 'popt_a', label: 'A was right', contestantId: 'con_a', sortOrder: 0 },
          { id: 'popt_b', label: 'B was right', contestantId: 'con_b', sortOrder: 1 },
          { id: 'popt_c', label: 'Both were out of line', sortOrder: 2 },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------

describe('voting on a perspective', () => {
  it('records the vote, updates the split and awards points', async () => {
    await seedOpenPerspective();
    const client = await makeUser('viewer@test.local', 'Viewer');

    const response = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.perspective.myOptionId).toBe('popt_a');
    expect(body.perspective.totalVotes).toBe(1);
    expect(body.pointsAwarded).toBe(3);

    const optionA = body.perspective.options.find((o: { id: string }) => o.id === 'popt_a');
    expect(optionA.voteCount).toBe(1);
    expect(optionA.percentage).toBe(100);
  });

  it('refuses a second vote from the same user', async () => {
    await seedOpenPerspective();
    const client = await makeUser('viewer@test.local', 'Viewer');

    await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });
    const second = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_b' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('VOTE_DUPLICATE');

    const stored = await db.audiencePerspective.findUniqueOrThrow({ where: { id: 'persp_test' } });
    expect(stored.totalVotes).toBe(1);
    expect(await db.perspectiveVote.count()).toBe(1);
    // The failed second vote must not have paid a second time either.
    expect(await db.pointsLedger.count({ where: { sourceId: 'persp_test' } })).toBe(1);
  });

  it('refuses a vote after the close time, even while the status still says OPEN', async () => {
    await seedOpenPerspective(-1000);
    const client = await makeUser('viewer@test.local', 'Viewer');

    const response = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ROUND_CLOSED');
    expect(await db.perspectiveVote.count()).toBe(0);
  });

  it('rejects an option from another perspective', async () => {
    await seedOpenPerspective();
    const client = await makeUser('viewer@test.local', 'Viewer');

    const response = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_from_nowhere' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('OPTION_INVALID');
  });

  it('rejects an anonymous vote', async () => {
    await seedOpenPerspective();
    const response = await app.inject({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('results visibility', () => {
  it('shows the split while voting is still open', async () => {
    await seedOpenPerspective();

    for (const index of [1, 2, 3]) {
      const client = await makeUser(`viewer${index}@test.local`, `Viewer${index}`);
      await client.request({
        method: 'POST',
        url: `${PERSPECTIVES}/persp_test/vote`,
        payload: { optionId: index === 3 ? 'popt_b' : 'popt_a' },
      });
    }

    // Anonymous, has not voted, perspective still open — the split is still visible,
    // because there is no future outcome for it to influence.
    const response = await app.inject({ method: 'GET', url: `${PERSPECTIVES}/persp_test` });
    const view = response.json().data;

    expect(view.isClosed).toBe(false);
    expect(view.totalVotes).toBe(3);
    expect(view.options.find((o: { id: string }) => o.id === 'popt_a').percentage).toBe(66.7);
    expect(view.options.find((o: { id: string }) => o.id === 'popt_b').percentage).toBe(33.3);
    expect(view.leadingOptionId).toBe('popt_a');
  });

  it('reports no leader on a dead heat', async () => {
    await seedOpenPerspective();

    const one = await makeUser('one@test.local', 'One');
    const two = await makeUser('two@test.local', 'Two');
    await one.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });
    await two.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_b' },
    });

    const view = (await app.inject({ method: 'GET', url: `${PERSPECTIVES}/persp_test` })).json()
      .data;
    expect(view.leadingOptionId).toBeNull();
  });

  it('carries the event it is about, with its contestants', async () => {
    await seedOpenPerspective();

    const view = (await app.inject({ method: 'GET', url: `${PERSPECTIVES}/persp_test` })).json()
      .data;

    expect(view.event.id).toBe('evt_test');
    expect(view.event.title).toBe('The kitchen argument');
    expect(view.event.contestants.map((c: { id: string }) => c.id).sort()).toEqual([
      'con_a',
      'con_b',
    ]);
  });

  it('filters by event and by contestant', async () => {
    await seedOpenPerspective();

    const byEvent = await app.inject({
      method: 'GET',
      url: `${PERSPECTIVES}?scope=all&eventId=evt_test`,
    });
    expect(byEvent.json().data).toHaveLength(1);

    const byContestant = await app.inject({
      method: 'GET',
      url: `${PERSPECTIVES}?scope=all&contestantId=con_a`,
    });
    expect(byContestant.json().data).toHaveLength(1);

    const noMatch = await app.inject({
      method: 'GET',
      url: `${PERSPECTIVES}?scope=all&contestantId=con_missing`,
    });
    expect(noMatch.json().data).toHaveLength(0);
  });

  it('lists only the perspectives a user has voted on under scope=mine', async () => {
    await seedOpenPerspective();
    await db.audiencePerspective.create({
      data: {
        id: 'persp_other',
        showId: 'show_test',
        eventId: 'evt_test',
        question: 'Something else entirely?',
        status: 'OPEN',
        closesAt: new Date(Date.now() + 3600_000),
        options: { create: [{ label: 'Yes' }, { label: 'No' }] },
      },
    });

    const client = await makeUser('viewer@test.local', 'Viewer');
    await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });

    const mine = await client.request({ method: 'GET', url: `${PERSPECTIVES}?scope=mine` });
    expect(mine.json().data).toHaveLength(1);
    expect(mine.json().data[0].id).toBe('persp_test');
  });
});

describe('analytics', () => {
  it('summarises consensus, participation and per-contestant support', async () => {
    await seedOpenPerspective();

    // 3 for A, 1 for B → a 50-point margin, which counts as decisive.
    for (const index of [1, 2, 3, 4]) {
      const client = await makeUser(`viewer${index}@test.local`, `Viewer${index}`);
      await client.request({
        method: 'POST',
        url: `${PERSPECTIVES}/persp_test/vote`,
        payload: { optionId: index === 4 ? 'popt_b' : 'popt_a' },
      });
    }

    const response = await app.inject({ method: 'GET', url: `${PERSPECTIVES}/analytics` });
    expect(response.statusCode).toBe(200);
    const analytics = response.json().data;

    expect(analytics.totalPerspectives).toBe(1);
    expect(analytics.totalVotes).toBe(4);
    expect(analytics.averageVotesPerPerspective).toBe(4);
    expect(analytics.consensus.decisive).toBe(1);

    const contestantA = analytics.byContestant.find(
      (entry: { contestantId: string }) => entry.contestantId === 'con_a',
    );
    expect(contestantA.votesFor).toBe(3);
    expect(contestantA.supportRate).toBe(75);

    expect(analytics.recent[0].margin).toBe(50);
  });

  it('does not divide by zero when nobody has voted', async () => {
    await seedOpenPerspective();

    const analytics = (await app.inject({ method: 'GET', url: `${PERSPECTIVES}/analytics` })).json()
      .data;

    expect(analytics.totalVotes).toBe(0);
    expect(analytics.averageVotesPerPerspective).toBe(0);
    expect(analytics.consensus).toEqual({ decisive: 0, split: 0, contested: 0 });
    expect(analytics.byContestant.every((e: { supportRate: number }) => e.supportRate === 0)).toBe(
      true,
    );
  });

  it('classifies a near-even split as contested rather than decisive', async () => {
    await seedOpenPerspective();

    const one = await makeUser('one@test.local', 'One');
    const two = await makeUser('two@test.local', 'Two');
    const three = await makeUser('three@test.local', 'Three');
    await one.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });
    await two.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_a' },
    });
    await three.request({
      method: 'POST',
      url: `${PERSPECTIVES}/persp_test/vote`,
      payload: { optionId: 'popt_b' },
    });

    const analytics = (await app.inject({ method: 'GET', url: `${PERSPECTIVES}/analytics` })).json()
      .data;
    // 2 vs 1 of 3 → 33.3 point margin → "split", not "decisive".
    expect(analytics.consensus.split).toBe(1);
    expect(analytics.consensus.decisive).toBe(0);
  });
});

describe('operator lifecycle', () => {
  it('refuses creation and lifecycle actions to an ordinary user', async () => {
    await seedOpenPerspective();
    const client = await makeUser('viewer@test.local', 'Viewer');

    const created = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin`,
      payload: {
        eventId: 'evt_test',
        question: 'Should this be allowed?',
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    });
    expect(created.statusCode).toBe(403);

    const closed = await client.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin/persp_test/close`,
    });
    expect(closed.statusCode).toBe(403);
  });

  it('creates a draft anchored to an event, then opens and closes it', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const created = await producer.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin`,
      payload: {
        eventId: 'evt_test',
        question: 'Was the immunity decision fair?',
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        options: [{ label: 'Fair' }, { label: 'Unfair' }],
      },
    });

    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    expect(created.json().data.status).toBe('DRAFT');

    // A draft is invisible to everyone.
    expect((await app.inject({ method: 'GET', url: `${PERSPECTIVES}/${id}` })).statusCode).toBe(404);

    const opened = await producer.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin/${id}/open`,
    });
    expect(opened.json().data.status).toBe('OPEN');
    expect((await app.inject({ method: 'GET', url: `${PERSPECTIVES}/${id}` })).statusCode).toBe(200);

    const closed = await producer.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin/${id}/close`,
    });
    expect(closed.json().data.status).toBe('CLOSED');

    const audit = await db.auditLog.findMany({ where: { entityType: 'AudiencePerspective' } });
    expect(audit.map((row) => row.action).sort()).toEqual([
      'perspective.close',
      'perspective.create',
      'perspective.open',
    ]);
  });

  it('refuses a perspective that is not anchored to a real event', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const response = await producer.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin`,
      payload: {
        eventId: 'evt_does_not_exist',
        question: 'A question with no event behind it?',
        closesAt: new Date(Date.now() + 3600_000).toISOString(),
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses to open a perspective whose close time has already passed', async () => {
    const producer = await makeUser('producer@test.local', 'Producer', 'PRODUCER');

    const created = await producer.request({
      method: 'POST',
      url: `${PERSPECTIVES}/admin`,
      payload: {
        eventId: 'evt_test',
        question: 'Already too late for this one?',
        closesAt: new Date(Date.now() + 2000).toISOString(),
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    });
    const id = created.json().data.id;

    await db.audiencePerspective.update({
      where: { id },
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    const response = await producer.request({ method: 'POST', url: `${PERSPECTIVES}/admin/${id}/open` });
    expect(response.statusCode).toBe(400);
  });
});
