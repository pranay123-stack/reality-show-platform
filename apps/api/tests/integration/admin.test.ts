import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const ADMIN = `${API_PREFIX}/admin`;

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Role = 'USER' | 'MODERATOR' | 'PRODUCER' | 'ADMIN';

async function makeUser(handle: string, role: Role = 'USER') {
  const email = `${handle}@test.local`;
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: sharedHash,
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: handle } },
    },
    select: { id: true },
  });

  const client = new TestClient(app);
  await client.request({
    method: 'POST',
    url: `${AUTH}/login`,
    payload: { email, password: VALID_PASSWORD },
  });
  return Object.assign(client, { userId: user.id, role });
}

let viewer: Awaited<ReturnType<typeof makeUser>>;
let moderator: Awaited<ReturnType<typeof makeUser>>;
let producer: Awaited<ReturnType<typeof makeUser>>;
let admin: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  await resetAll();
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });

  [viewer, moderator, producer, admin] = await Promise.all([
    makeUser('viewer', 'USER'),
    makeUser('moderator', 'MODERATOR'),
    makeUser('producer', 'PRODUCER'),
    makeUser('admin', 'ADMIN'),
  ]);
});

const auditActions = async () =>
  (await db.auditLog.findMany({ select: { action: true } })).map((row) => row.action);

// ---------------------------------------------------------------------------
// 1. A viewer has no console
// ---------------------------------------------------------------------------

describe('a viewer is denied the console', () => {
  it('cannot open the overview or the section list', async () => {
    for (const url of [`${ADMIN}/overview`, `${ADMIN}/sections`]) {
      expect((await viewer.request({ method: 'GET', url })).statusCode).toBe(403);
    }
  });

  it('cannot read the audit trail', async () => {
    expect((await viewer.request({ method: 'GET', url: `${ADMIN}/audit` })).statusCode).toBe(403);
    expect(
      (await viewer.request({ method: 'GET', url: `${ADMIN}/audit/facets` })).statusCode,
    ).toBe(403);
  });

  it('is refused anonymously too', async () => {
    expect((await app.inject({ method: 'GET', url: `${ADMIN}/overview` })).statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2. Moderator: a real but narrow console
// ---------------------------------------------------------------------------

describe('a moderator gets a narrow console', () => {
  it('sees only the sections they can work', async () => {
    const response = await moderator.request({ method: 'GET', url: `${ADMIN}/sections` });
    expect(response.statusCode).toBe(200);

    const { sections } = response.json().data as { sections: string[] };
    expect(sections).toEqual(
      expect.arrayContaining(['overview', 'challenges', 'rewards', 'notifications']),
    );
    // Nothing that belongs to a producer or an admin.
    expect(sections).not.toContain('predictions');
    expect(sections).not.toContain('contestants');
    expect(sections).not.toContain('kitchen');
    expect(sections).not.toContain('audit');
  });

  it('can open the overview', async () => {
    const response = await moderator.request({ method: 'GET', url: `${ADMIN}/overview` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.cards.length).toBeGreaterThan(0);
  });

  it('cannot read the audit trail', async () => {
    expect((await moderator.request({ method: 'GET', url: `${ADMIN}/audit` })).statusCode).toBe(403);
  });

  it('cannot run show operations', async () => {
    const blocked = [
      { method: 'POST' as const, url: `${API_PREFIX}/predictions/admin`, payload: {} },
      { method: 'POST' as const, url: `${API_PREFIX}/polls/admin`, payload: {} },
      { method: 'POST' as const, url: `${API_PREFIX}/contestants/admin`, payload: {} },
      { method: 'GET' as const, url: `${API_PREFIX}/contestants/admin/list` },
    ];

    for (const request of blocked) {
      expect((await moderator.request(request)).statusCode).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Producer and admin
// ---------------------------------------------------------------------------

describe('a producer runs the show', () => {
  it('sees the show sections but not the audit trail', async () => {
    const { sections } = (
      await producer.request({ method: 'GET', url: `${ADMIN}/sections` })
    ).json().data as { sections: string[] };

    expect(sections).toEqual(
      expect.arrayContaining(['contestants', 'predictions', 'polls', 'kitchen', 'weekend']),
    );
    expect(sections).not.toContain('audit');
  });

  it('can manage contestants end to end', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'Aria Vale', slug: 'aria-vale', occupation: 'Chef' },
    });
    expect(created.statusCode).toBe(201);
    const contestantId = created.json().data.id as string;

    const updated = await producer.request({
      method: 'PATCH',
      url: `${API_PREFIX}/contestants/admin/${contestantId}`,
      payload: { tagline: 'Runs the kitchen' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.tagline).toBe('Runs the kitchen');

    const evicted = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin/${contestantId}/status`,
      payload: { status: 'EVICTED', reason: 'Voted out on night twelve' },
    });
    expect(evicted.statusCode).toBe(200);
    expect(evicted.json().data.status).toBe('EVICTED');
    // An exit is dated, not deleted: their votes and heat history still point here.
    expect(evicted.json().data.exitedAt).not.toBeNull();

    const list = await producer.request({
      method: 'GET',
      url: `${API_PREFIX}/contestants/admin/list`,
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].engagement).toBeDefined();
  });

  it('refuses a duplicate slug rather than shadowing the first', async () => {
    const payload = { displayName: 'Twin', slug: 'twin' };
    expect(
      (await producer.request({ method: 'POST', url: `${API_PREFIX}/contestants/admin`, payload }))
        .statusCode,
    ).toBe(201);
    expect(
      (await producer.request({ method: 'POST', url: `${API_PREFIX}/contestants/admin`, payload }))
        .statusCode,
    ).toBe(409);
  });

  it('cannot set a heat score by hand', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      // Heat is a measurement; the schema strips any attempt to type one in.
      payload: { displayName: 'Hot Take', slug: 'hot-take', heatScore: 99 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.heatScore).toBe(50);
  });
});

describe('an admin sees everything', () => {
  it('gets every section', async () => {
    const { sections } = (
      await admin.request({ method: 'GET', url: `${ADMIN}/sections` })
    ).json().data as { sections: string[] };

    expect(sections).toEqual(
      expect.arrayContaining([
        'overview',
        'contestants',
        'predictions',
        'polls',
        'challenges',
        'kitchen',
        'weekend',
        'rewards',
        'leaderboard',
        'notifications',
        'audit',
      ]),
    );
  });

  it('gets an overview that adds up', async () => {
    const response = await admin.request({ method: 'GET', url: `${ADMIN}/overview` });
    expect(response.statusCode).toBe(200);

    const data = response.json().data;
    expect(data.cards.map((card: { key: string }) => card.key)).toEqual(
      expect.arrayContaining(['activeUsers', 'livePolls', 'openPredictions', 'moderation']),
    );
    // Seven days of participation, gaps filled rather than omitted.
    expect(data.participation.days).toHaveLength(7);
    expect(data.show).toMatchObject({ name: 'Test Show', isLive: true });
  });
});

// ---------------------------------------------------------------------------
// 5. Audit
// ---------------------------------------------------------------------------

describe('the audit trail', () => {
  it('records an action with its actor, module and payload', async () => {
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'Audited', slug: 'audited' },
    });

    const response = await admin.request({ method: 'GET', url: `${ADMIN}/audit` });
    expect(response.statusCode).toBe(200);

    const entry = response.json().data.items[0];
    expect(entry).toMatchObject({
      action: 'contestant.create',
      module: 'contestant',
      entityType: 'Contestant',
      actorRole: 'PRODUCER',
    });
    expect(entry.actor.displayName).toBe('producer');
    expect(entry.after.displayName).toBe('Audited');
  });

  it('filters by module, actor and action', async () => {
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'One', slug: 'one' },
    });
    await admin.request({
      method: 'POST',
      url: `${API_PREFIX}/notifications/admin/announce`,
      payload: { title: 'Hello everyone', body: 'Tonight at eight.' },
    });

    const byModule = await admin.request({ method: 'GET', url: `${ADMIN}/audit?module=contestant` });
    expect(byModule.json().data.items).toHaveLength(1);
    expect(byModule.json().data.items[0].action).toBe('contestant.create');

    const byActor = await admin.request({
      method: 'GET',
      url: `${ADMIN}/audit?actorId=${admin.userId}`,
    });
    expect(byActor.json().data.items.every((item: { actor: { id: string } }) => item.actor.id === admin.userId)).toBe(true);

    const byAction = await admin.request({ method: 'GET', url: `${ADMIN}/audit?action=announce` });
    expect(byAction.json().data.items).toHaveLength(1);
  });

  it('filters by date range', async () => {
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'Dated', slug: 'dated' },
    });

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    const inRange = await admin.request({
      method: 'GET',
      url: `${ADMIN}/audit?from=${yesterday}&to=${tomorrow}`,
    });
    expect(inRange.json().data.items.length).toBeGreaterThan(0);

    const beforeAnything = await admin.request({
      method: 'GET',
      url: `${ADMIN}/audit?to=${yesterday}`,
    });
    expect(beforeAnything.json().data.items).toHaveLength(0);
  });

  it('offers filter values drawn from what was actually recorded', async () => {
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'Facet', slug: 'facet' },
    });

    const facets = await admin.request({ method: 'GET', url: `${ADMIN}/audit/facets` });
    const data = facets.json().data;
    expect(data.actions).toContain('contestant.create');
    expect(data.modules).toContain('contestant');
    expect(data.entityTypes).toContain('Contestant');
    expect(data.actors.map((actor: { displayName: string }) => actor.displayName)).toContain(
      'producer',
    );
  });

  it('is append-only — there is no endpoint that edits or deletes a row', async () => {
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'Permanent', slug: 'permanent' },
    });
    const [entry] = await db.auditLog.findMany();

    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const response = await admin.request({
        method,
        url: `${ADMIN}/audit/${entry!.id}`,
        payload: { action: 'tampered' },
      });
      expect(response.statusCode).toBe(404);
    }

    const untouched = await db.auditLog.findUniqueOrThrow({ where: { id: entry!.id } });
    expect(untouched.action).toBe('contestant.create');
  });
});

// ---------------------------------------------------------------------------
// 6. Prediction lifecycle from the console
// ---------------------------------------------------------------------------

describe('prediction lifecycle from the console', () => {
  it('runs create → open → close → resolve, auditing each step', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/admin`,
      payload: {
        question: 'Who is nominated tonight?',
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        rewardPoints: 50,
        options: [{ label: 'Aria' }, { label: 'Dev' }],
      },
    });
    expect(created.statusCode).toBe(201);
    const predictionId = created.json().data.id as string;
    const optionId = created.json().data.options[0].id as string;

    expect(
      (
        await producer.request({
          method: 'POST',
          url: `${API_PREFIX}/predictions/admin/${predictionId}/activate`,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    // Somebody plays, so resolving has a payout to make.
    const player = await makeUser('player');
    expect(
      (
        await player.request({
          method: 'POST',
          url: `${API_PREFIX}/predictions/${predictionId}/entries`,
          payload: { optionId },
        })
      ).statusCode,
    ).toBe(200);

    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/admin/${predictionId}/close`,
      payload: {},
    });

    const resolved = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/admin/${predictionId}/resolve`,
      payload: { correctOptionId: optionId, notes: 'Confirmed on air' },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.usersCredited).toBe(1);

    const actions = await auditActions();
    expect(actions).toEqual(
      expect.arrayContaining([
        'prediction.create',
        'prediction.activate',
        'prediction.close',
        'prediction.resolve',
      ]),
    );
  });

  it('shows the operator the distribution the audience cannot see', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/admin`,
      payload: {
        question: 'Who wins the task?',
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        options: [{ label: 'Aria' }, { label: 'Dev' }],
      },
    });
    const predictionId = created.json().data.id as string;
    const optionId = created.json().data.options[0].id as string;

    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/admin/${predictionId}/activate`,
      payload: {},
    });

    const player = await makeUser('player');
    await player.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/${predictionId}/entries`,
      payload: { optionId },
    });

    // The public view withholds the split so nobody can follow the crowd…
    const publicView = await player.request({
      method: 'GET',
      url: `${API_PREFIX}/predictions/${predictionId}`,
    });
    expect(publicView.json().data.options[0].entryCount).toBe(0);

    // …while the operator, who has to judge the question, can see it.
    const operatorView = await producer.request({
      method: 'GET',
      url: `${API_PREFIX}/predictions/admin/list`,
    });
    const found = operatorView
      .json()
      .data.find((prediction: { id: string }) => prediction.id === predictionId);
    expect(found.options[0].entryCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Poll lifecycle from the console
// ---------------------------------------------------------------------------

describe('poll lifecycle from the console', () => {
  it('runs create → start → pause → resume → close → publish', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin`,
      payload: {
        question: 'Who should get immunity?',
        durationSeconds: 120,
        options: [{ label: 'Aria' }, { label: 'Dev' }],
      },
    });
    expect(created.statusCode).toBe(201);
    const pollId = created.json().data.id as string;

    for (const verb of ['activate', 'pause', 'activate', 'close', 'publish']) {
      const response = await producer.request({
        method: 'POST',
        url: `${API_PREFIX}/polls/admin/${pollId}/${verb}`,
        payload: {},
      });
      expect(response.statusCode, `${verb} should succeed`).toBe(200);
    }

    const actions = await auditActions();
    expect(actions).toEqual(
      expect.arrayContaining(['poll.create', 'poll.activate', 'poll.close', 'poll.publish']),
    );
  });

  it('refuses an illegal jump in the lifecycle', async () => {
    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin`,
      payload: {
        question: 'Never started poll',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    });
    const pollId = created.json().data.id as string;

    // A draft cannot be published; the state machine says so, not the UI.
    const published = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/${pollId}/publish`,
      payload: {},
    });
    expect(published.statusCode).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// 8. Reward permissions
// ---------------------------------------------------------------------------

describe('reward management permissions', () => {
  it('splits catalogue work from the destructive actions', async () => {
    // A moderator may look.
    expect(
      (await moderator.request({ method: 'GET', url: `${API_PREFIX}/rewards/admin/catalogue` }))
        .statusCode,
    ).toBe(200);

    // …but not create.
    const asModerator = await moderator.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin`,
      payload: { code: 'BADGE_X', name: 'Badge', category: 'DIGITAL', type: 'DIGITAL_BADGE', pointCost: 10 },
    });
    expect(asModerator.statusCode).toBe(403);

    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/rewards/admin`,
      payload: { code: 'BADGE_X', name: 'Badge', category: 'DIGITAL', type: 'DIGITAL_BADGE', pointCost: 10 },
    });
    expect(created.statusCode).toBe(201);
    const rewardId = created.json().data.id as string;

    // Retiring takes something away from users, so it stays with admins.
    expect(
      (
        await producer.request({
          method: 'POST',
          url: `${API_PREFIX}/rewards/admin/${rewardId}/retire`,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await admin.request({
          method: 'POST',
          url: `${API_PREFIX}/rewards/admin/${rewardId}/retire`,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    expect(await auditActions()).toEqual(
      expect.arrayContaining(['reward.create', 'reward.retire']),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Challenge moderation
// ---------------------------------------------------------------------------

describe('challenge moderation workflow', () => {
  async function submitChallenge(author: Awaited<ReturnType<typeof makeUser>>) {
    const created = await author.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges`,
      payload: {
        title: 'Silent breakfast',
        description: 'The house must eat breakfast without speaking a single word.',
        category: 'SOCIAL',
      },
    });
    const id = created.json().data.id as string;
    await author.request({ method: 'POST', url: `${API_PREFIX}/challenges/${id}/submit`, payload: {} });
    return id;
  }

  it('lets a moderator work the queue and audits the decision', async () => {
    const author = await makeUser('author');
    const challengeId = await submitChallenge(author);

    const queue = await moderator.request({
      method: 'GET',
      url: `${API_PREFIX}/challenges/admin/queue`,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.length).toBeGreaterThan(0);

    const approved = await moderator.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges/admin/${challengeId}/moderate`,
      payload: { decision: 'APPROVE' },
    });
    expect(approved.statusCode).toBe(200);
    expect(await auditActions()).toContain('challenge.approve');
  });

  it('keeps selection with a producer, not a moderator', async () => {
    const author = await makeUser('author');
    const challengeId = await submitChallenge(author);

    await moderator.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges/admin/${challengeId}/moderate`,
      payload: { decision: 'APPROVE' },
    });

    // Opening community voting is a producer-level cycle action.
    const asModerator = await moderator.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges/admin/${challengeId}/open-voting`,
      payload: {},
    });
    expect(asModerator.statusCode).toBe(403);

    const asProducer = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/challenges/admin/${challengeId}/open-voting`,
      payload: {},
    });
    expect(asProducer.statusCode).toBe(200);
  });

  it('refuses the queue to an ordinary user', async () => {
    expect(
      (await viewer.request({ method: 'GET', url: `${API_PREFIX}/challenges/admin/queue` }))
        .statusCode,
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 10. Unauthorised mutation, everywhere
// ---------------------------------------------------------------------------

describe('the API refuses an unauthorised mutation regardless of the UI', () => {
  it('blocks every operator verb for an ordinary user', async () => {
    const mutations = [
      { url: `${API_PREFIX}/contestants/admin`, payload: { displayName: 'X', slug: 'x' } },
      { url: `${API_PREFIX}/predictions/admin`, payload: { question: 'X' } },
      { url: `${API_PREFIX}/polls/admin`, payload: { question: 'X' } },
      { url: `${API_PREFIX}/kitchen/admin`, payload: { title: 'X' } },
      { url: `${API_PREFIX}/weekend/admin`, payload: { title: 'X' } },
      { url: `${API_PREFIX}/rewards/admin`, payload: { code: 'X', name: 'X' } },
      { url: `${API_PREFIX}/leaderboards/admin/rebuild`, payload: { window: 'SEASON' } },
      { url: `${API_PREFIX}/notifications/admin/announce`, payload: { title: 'Hi', body: 'There' } },
    ];

    for (const mutation of mutations) {
      const response = await viewer.request({ method: 'POST', ...mutation });
      expect(response.statusCode, `${mutation.url} must be refused`).toBe(403);
    }

    // Nothing was created by any of them.
    expect(await db.contestant.count()).toBe(0);
    expect(await db.prediction.count()).toBe(0);
    expect(await db.livePoll.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it('refuses a mutation to a signed-out caller', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'X', slug: 'x' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not let a moderator escalate by calling a producer route directly', async () => {
    // The console would never show the button; the point is that the API does
    // not rely on that.
    const response = await moderator.request({
      method: 'POST',
      url: `${API_PREFIX}/predictions/admin`,
      payload: {
        question: 'Sneaky prediction',
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        options: [{ label: 'A' }, { label: 'B' }],
      },
    });
    expect(response.statusCode).toBe(403);
    expect(await db.prediction.count()).toBe(0);
  });

  it('audits nothing when an action is refused', async () => {
    await viewer.request({
      method: 'POST',
      url: `${API_PREFIX}/contestants/admin`,
      payload: { displayName: 'X', slug: 'x' },
    });
    // A refused action is not an action.
    expect(await db.auditLog.count()).toBe(0);
  });
});
