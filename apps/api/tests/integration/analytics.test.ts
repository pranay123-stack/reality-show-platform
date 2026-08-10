import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { aggregateDay, aggregateRange, snapshotDay, startOfDayUtc } from '../../src/modules/analytics/aggregation.js';
import {
  clearOptOutCache,
  sanitiseProperties,
  settleAnalytics,
  track,
} from '../../src/modules/analytics/analytics.service.js';
import { getEventBreakdown, getOverview } from '../../src/modules/analytics/reporting.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const ANALYTICS = `${API_PREFIX}/analytics`;

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
  clearOptOutCache();
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
});

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
  return Object.assign(client, { userId: user.id, email });
}

/**
 * Clears the log after fixture setup.
 *
 * Signing a user in legitimately records `login` and `session_started`, so a
 * test asserting on counts has to start from a known point. Clearing is
 * honest here — those events are real, they are simply not what is under test.
 */
const resetEvents = async () => {
  await settleAnalytics();
  await db.analyticsEvent.deleteMany();
};

const daysAgo = (days: number) => {
  const day = startOfDayUtc(new Date());
  day.setUTCDate(day.getUTCDate() - days);
  day.setUTCHours(12, 0, 0, 0);
  return day;
};

// ---------------------------------------------------------------------------
// 1. An event creates a record
// ---------------------------------------------------------------------------

describe('1. events become records', () => {
  it('records a server-side event with its subject and context', async () => {
    const user = await makeUser('viewer');
    await resetEvents();

    await track({ name: 'poll_voted', userId: user.userId, entityId: 'poll_1' });

    const [event] = await db.analyticsEvent.findMany({ where: { userId: user.userId } });
    expect(event).toMatchObject({ name: 'poll_voted', userId: user.userId });
    expect((event!.properties as { entityId: string }).entityId).toBe('poll_1');
  });

  it('records a client-reported view through the ingest', async () => {
    const user = await makeUser('viewer');

    const response = await user.request({
      method: 'POST',
      url: `${ANALYTICS}/events`,
      payload: {
        events: [
          { name: 'poll_viewed', entityId: 'poll_1' },
          { name: 'contestant_viewed', entityId: 'con_1' },
        ],
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data.accepted).toBe(2);

    // Ingest is fire-and-forget, so the write settles just after the response.
    await settleAnalytics();
    const names = (await db.analyticsEvent.findMany({ where: { userId: user.userId } })).map(
      (event) => event.name,
    );
    expect(names).toEqual(expect.arrayContaining(['poll_viewed', 'contestant_viewed']));
  });

  it('accepts a view from a signed-out visitor without attributing it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${ANALYTICS}/events`,
      payload: { events: [{ name: 'contestant_viewed', entityId: 'con_1' }] },
    });
    expect(response.statusCode).toBe(202);

    await settleAnalytics();
    const [event] = await db.analyticsEvent.findMany();
    expect(event!.userId).toBeNull();
  });

  it('refuses a client attempt to report an event with consequences', async () => {
    const user = await makeUser('viewer');

    // A vote, a redemption and a signup are recorded from the action itself.
    // Accepting them here would let a client inflate the numbers that matter.
    await resetEvents();

    for (const name of ['poll_voted', 'reward_redeemed', 'signup', 'prediction_correct']) {
      const response = await user.request({
        method: 'POST',
        url: `${ANALYTICS}/events`,
        payload: { events: [{ name }] },
      });
      expect(response.statusCode, name).toBe(400);
    }

    expect(await db.analyticsEvent.count()).toBe(0);
  });

  it('records a vote from the action, not from the client', async () => {
    const producer = await makeUser('producer', 'PRODUCER');
    const voter = await makeUser('voter');
    await resetEvents();

    const created = await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin`,
      payload: {
        question: 'Who should win?',
        durationSeconds: 600,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    });
    const poll = created.json().data;
    await producer.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/${poll.id}/activate`,
      payload: {},
    });

    await voter.request({
      method: 'POST',
      url: `${API_PREFIX}/polls/${poll.id}/vote`,
      payload: { optionId: poll.options[0].id },
    });

    await settleAnalytics();
    const events = await db.analyticsEvent.findMany({ where: { name: 'poll_voted' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.userId).toBe(voter.userId);
  });
});

// ---------------------------------------------------------------------------
// 2. Aggregation
// ---------------------------------------------------------------------------

describe('2. aggregation', () => {
  it('counts events and distinct users for a day', async () => {
    const one = await makeUser('one');
    const two = await makeUser('two');
    const at = daysAgo(1);

    // One user votes twice, the other once: three events, two people.
    await track({ name: 'poll_voted', userId: one.userId, entityId: 'p1', occurredAt: at });
    await track({ name: 'poll_voted', userId: one.userId, entityId: 'p2', occurredAt: at });
    await track({ name: 'poll_voted', userId: two.userId, entityId: 'p1', occurredAt: at });

    await aggregateDay(at);

    const row = await db.analyticsAggregate.findFirstOrThrow({
      where: { metric: 'poll_participation', date: startOfDayUtc(at) },
    });
    expect(row.value).toBe(3);
    expect(row.uniqueUsers).toBe(2);

    const dau = await db.analyticsAggregate.findFirstOrThrow({
      where: { metric: 'dau', date: startOfDayUtc(at) },
    });
    expect(dau.value).toBe(2);
  });

  it('keeps days apart', async () => {
    const user = await makeUser('viewer');

    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1', occurredAt: daysAgo(2) });
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p2', occurredAt: daysAgo(1) });

    await aggregateDay(daysAgo(2));
    await aggregateDay(daysAgo(1));

    const rows = await db.analyticsAggregate.findMany({
      where: { metric: 'poll_participation' },
      orderBy: { date: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.value === 1)).toBe(true);
  });

  it('replaces a day rather than adding to it when re-run', async () => {
    const user = await makeUser('viewer');
    const at = daysAgo(1);
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1', occurredAt: at });

    await aggregateDay(at);
    await aggregateDay(at);
    await aggregateDay(at);

    const rows = await db.analyticsAggregate.findMany({
      where: { metric: 'poll_participation', date: startOfDayUtc(at) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(1);
  });

  it('computes rolling windows that cannot be summed from days', async () => {
    const one = await makeUser('one');
    const two = await makeUser('two');
    await resetEvents();

    // The same person active on three days is one weekly active, not three.
    for (const offset of [3, 2, 1]) {
      await track({ name: 'poll_voted', userId: one.userId, entityId: 'p', occurredAt: daysAgo(offset) });
    }
    await track({ name: 'poll_voted', userId: two.userId, entityId: 'p', occurredAt: daysAgo(1) });

    await aggregateRange(4);

    const snapshot = await db.analyticsSnapshot.findFirstOrThrow({ orderBy: { date: 'desc' } });
    expect(snapshot.wau).toBe(2);
    expect(snapshot.dau).toBe(0); // nothing happened today
  });

  it('measures next-day return', async () => {
    const loyal = await makeUser('loyal');
    const gone = await makeUser('gone');
    await resetEvents();
    const today = startOfDayUtc(new Date());
    today.setUTCHours(9);

    await track({ name: 'poll_voted', userId: loyal.userId, entityId: 'p', occurredAt: daysAgo(1) });
    await track({ name: 'poll_voted', userId: gone.userId, entityId: 'p', occurredAt: daysAgo(1) });
    await track({ name: 'poll_voted', userId: loyal.userId, entityId: 'p2', occurredAt: today });

    await aggregateRange(2);

    const snapshot = await db.analyticsSnapshot.findFirstOrThrow({
      where: { date: startOfDayUtc(new Date()) },
    });
    // One of the two came back.
    expect(snapshot.retentionD1).toBe(50);
  });

  it('reports a funnel and feature adoption from aggregates alone', async () => {
    const user = await makeUser('viewer');
    const at = daysAgo(1);

    await track({ name: 'poll_viewed', userId: user.userId, entityId: 'p1', occurredAt: at });
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1', occurredAt: at });
    await aggregateRange(2);

    const overview = await getOverview(7);
    const viewed = overview.engagementFunnel.find((step) => step.key === 'viewed');
    const voted = overview.engagementFunnel.find((step) => step.key === 'voted');

    expect(viewed!.users).toBe(1);
    expect(voted!.users).toBe(1);
    expect(voted!.ofPrevious).toBe(100);

    const poll = overview.featureUsage.find((feature) => feature.feature === 'poll');
    expect(poll!.events).toBe(1);
    expect(poll!.users).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate events
// ---------------------------------------------------------------------------

describe('3. duplicate events', () => {
  it('collapses a repeated view to one record', async () => {
    const user = await makeUser('viewer');

    // What a client does when somebody scrolls a list twenty times.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await user.request({
        method: 'POST',
        url: `${ANALYTICS}/events`,
        payload: { events: [{ name: 'poll_viewed', entityId: 'poll_1' }] },
      });
    }

    await settleAnalytics();
    expect(await db.analyticsEvent.count({ where: { name: 'poll_viewed' } })).toBe(1);
  });

  it('keeps distinct subjects distinct', async () => {
    const user = await makeUser('viewer');

    await user.request({
      method: 'POST',
      url: `${ANALYTICS}/events`,
      payload: {
        events: [
          { name: 'poll_viewed', entityId: 'poll_1' },
          { name: 'poll_viewed', entityId: 'poll_2' },
        ],
      },
    });

    await settleAnalytics();
    expect(await db.analyticsEvent.count({ where: { name: 'poll_viewed' } })).toBe(2);
  });

  it('counts a countable event every time', async () => {
    const user = await makeUser('viewer');

    // A vote in two different polls is two votes; no dedupe key is supplied.
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1' });
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p2' });

    expect(await db.analyticsEvent.count({ where: { name: 'poll_voted' } })).toBe(2);
  });

  it('is idempotent when a domain event is replayed', async () => {
    const user = await makeUser('viewer');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await track({
        name: 'reward_redeemed',
        userId: user.userId,
        entityId: 'red_1',
        dedupeKey: `reward_redeemed:${user.userId}:red_1`,
      });
    }

    expect(await db.analyticsEvent.count({ where: { name: 'reward_redeemed' } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Opt-out
// ---------------------------------------------------------------------------

describe('4. opt-out', () => {
  it('records nothing at all for an opted-out account', async () => {
    const user = await makeUser('private');

    const response = await user.request({
      method: 'PATCH',
      url: `${ANALYTICS}/me/privacy`,
      payload: { optOut: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.optedOut).toBe(true);

    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1' });
    await track({ name: 'prediction_submitted', userId: user.userId, entityId: 'pred_1' });

    // Not anonymised — absent. An opt-out that stores a de-identified row is
    // still storing a row about somebody who asked not to be measured.
    expect(await db.analyticsEvent.count({ where: { userId: user.userId } })).toBe(0);
    expect(await db.analyticsEvent.count()).toBe(0);
  });

  it('erases what was already collected', async () => {
    const user = await makeUser('private');
    await resetEvents();
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1' });
    expect(await db.analyticsEvent.count({ where: { userId: user.userId } })).toBe(1);

    await user.request({
      method: 'PATCH',
      url: `${ANALYTICS}/me/privacy`,
      payload: { optOut: true },
    });

    // Retrospective: an opt-out that leaves a year of history behind is not one.
    expect(await db.analyticsEvent.count({ where: { userId: user.userId } })).toBe(0);
  });

  it('resumes collection when the user opts back in', async () => {
    const user = await makeUser('private');

    await user.request({ method: 'PATCH', url: `${ANALYTICS}/me/privacy`, payload: { optOut: true } });
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p1' });
    expect(await db.analyticsEvent.count()).toBe(0);

    await user.request({ method: 'PATCH', url: `${ANALYTICS}/me/privacy`, payload: { optOut: false } });
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p2' });
    expect(await db.analyticsEvent.count()).toBe(1);
  });

  it('does not affect anybody else', async () => {
    const quiet = await makeUser('quiet');
    const other = await makeUser('other');

    await quiet.request({ method: 'PATCH', url: `${ANALYTICS}/me/privacy`, payload: { optOut: true } });
    await resetEvents();

    await track({ name: 'poll_voted', userId: quiet.userId, entityId: 'p1' });
    await track({ name: 'poll_voted', userId: other.userId, entityId: 'p1' });

    expect(await db.analyticsEvent.count()).toBe(1);
    expect((await db.analyticsEvent.findFirstOrThrow()).userId).toBe(other.userId);
  });

  it('tells an operator how much of the platform is excluded', async () => {
    const admin = await makeUser('admin', 'ADMIN');
    const quiet = await makeUser('quiet');
    await makeUser('other');

    await quiet.request({ method: 'PATCH', url: `${ANALYTICS}/me/privacy`, payload: { optOut: true } });

    const response = await admin.request({ method: 'GET', url: `${ANALYTICS}/admin/overview` });
    const privacy = response.json().data.privacy;

    // The gap is surfaced, not hidden: a reader has to know the denominator.
    expect(privacy.optedOut).toBe(1);
    expect(privacy.totalUsers).toBe(3);
    expect(privacy.coveragePercent).toBeCloseTo(66.7, 0);
  });

  it('reports the user their own setting', async () => {
    const user = await makeUser('viewer');

    expect((await user.request({ method: 'GET', url: `${ANALYTICS}/me/privacy` })).json().data)
      .toEqual({ optedOut: false });

    await user.request({ method: 'PATCH', url: `${ANALYTICS}/me/privacy`, payload: { optOut: true } });

    expect((await user.request({ method: 'GET', url: `${ANALYTICS}/me/privacy` })).json().data)
      .toEqual({ optedOut: true });
  });
});

// ---------------------------------------------------------------------------
// 5. No sensitive fields
// ---------------------------------------------------------------------------

describe('5. sensitive fields are never stored', () => {
  it('strips anything that looks like a credential or a contact detail', () => {
    const clean = sanitiseProperties({
      password: 'hunter2',
      accessToken: 'ey...',
      refreshToken: 'abc',
      userEmail: 'someone@example.com',
      EMAIL_ADDRESS: 'other@example.com',
      phoneNumber: '+447700900000',
      ipAddress: '203.0.113.4',
      sessionId: 'sess_1',
      passwordHash: 'x',
      apiSecret: 'y',
      cardNumber: '4111111111111111',
      // Legitimate context survives.
      pollId: 'poll_1',
      position: 3,
      isFirst: true,
    });

    expect(clean).toEqual({ pollId: 'poll_1', position: 3, isFirst: true });
  });

  it('drops values that are too long or the wrong shape to be context', () => {
    const clean = sanitiseProperties({
      note: 'x'.repeat(500),
      nested: { deep: 'value' },
      list: [1, 2, 3],
      nothing: null,
      ok: 'short',
    });

    expect(clean).toEqual({ ok: 'short' });
  });

  it('caps how many properties one event can carry', () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`key${index}`, index]),
    );
    expect(Object.keys(sanitiseProperties(many)).length).toBeLessThanOrEqual(12);
  });

  it('stores nothing sensitive through the real ingest path', async () => {
    const user = await makeUser('viewer');
    await resetEvents();

    await user.request({
      method: 'POST',
      url: `${ANALYTICS}/events`,
      payload: {
        events: [
          {
            name: 'poll_viewed',
            entityId: 'poll_1',
            properties: { password: 'hunter2', email: 'a@b.c', pollType: 'live' },
          },
        ],
      },
    });

    await settleAnalytics();
    const event = await db.analyticsEvent.findFirstOrThrow();
    const properties = event.properties as Record<string, unknown>;

    expect(properties.password).toBeUndefined();
    expect(properties.email).toBeUndefined();
    expect(properties.pollType).toBe('live');
    expect(JSON.stringify(event)).not.toContain('hunter2');
  });

  it('never stores a raw address or user agent on an event', async () => {
    const user = await makeUser('viewer');
    await resetEvents();
    await user.request({
      method: 'POST',
      url: `${ANALYTICS}/events`,
      payload: { events: [{ name: 'poll_viewed', entityId: 'p1' }] },
    });

    await settleAnalytics();
    const event = await db.analyticsEvent.findFirstOrThrow();
    const serialised = JSON.stringify(event);

    // The schema has no column for either, and nothing smuggles them into
    // properties.
    expect(serialised).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(serialised.toLowerCase()).not.toContain('mozilla');
  });
});

// ---------------------------------------------------------------------------
// 6. Date range filtering
// ---------------------------------------------------------------------------

describe('6. date ranges', () => {
  it('returns exactly the requested number of days, gaps included', async () => {
    const user = await makeUser('viewer');
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p', occurredAt: daysAgo(1) });
    await aggregateRange(3);

    for (const days of [7, 14, 30]) {
      const overview = await getOverview(days);
      expect(overview.rangeDays).toBe(days);
      expect(overview.participation).toHaveLength(days);
      // A quiet day is a zero, not a missing point.
      expect(overview.participation.every((point) => typeof point.value === 'number')).toBe(true);
    }
  });

  it('excludes activity outside the window', async () => {
    const user = await makeUser('viewer');

    await track({ name: 'poll_voted', userId: user.userId, entityId: 'old', occurredAt: daysAgo(40) });
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'new', occurredAt: daysAgo(1) });
    await aggregateDay(daysAgo(40));
    await aggregateDay(daysAgo(1));

    const narrow = await getOverview(7);
    const wide = await getOverview(60);

    const total = (overview: Awaited<ReturnType<typeof getOverview>>) =>
      overview.summary.find((metric) => metric.metric === 'poll_participation')!.series.reduce(
        (sum, point) => sum + point.value,
        0,
      );

    expect(total(narrow)).toBe(1);
    expect(total(wide)).toBe(2);
  });

  it('refuses a nonsensical range rather than guessing', async () => {
    const admin = await makeUser('admin', 'ADMIN');

    for (const days of ['0', '-5', '9999', 'lots']) {
      const response = await admin.request({
        method: 'GET',
        url: `${ANALYTICS}/admin/overview?days=${days}`,
      });
      expect(response.statusCode, days).toBe(400);
    }
  });

  it('breaks events down over the window', async () => {
    const user = await makeUser('viewer');
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p', occurredAt: daysAgo(1) });
    await track({ name: 'kitchen_voted', userId: user.userId, entityId: 'k', occurredAt: daysAgo(1) });
    await aggregateDay(daysAgo(1));

    const breakdown = await getEventBreakdown(7);
    expect(breakdown.map((row) => row.name)).toEqual(
      expect.arrayContaining(['poll_voted', 'kitchen_voted']),
    );
    expect(breakdown.find((row) => row.name === 'poll_voted')).toMatchObject({
      category: 'poll',
      events: 1,
      users: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Permissions
// ---------------------------------------------------------------------------

describe('7. permissions', () => {
  it('refuses the dashboard to a user and a moderator', async () => {
    const viewer = await makeUser('viewer');
    const moderator = await makeUser('moderator', 'MODERATOR');

    for (const client of [viewer, moderator]) {
      expect(
        (await client.request({ method: 'GET', url: `${ANALYTICS}/admin/overview` })).statusCode,
      ).toBe(403);
      expect(
        (await client.request({ method: 'GET', url: `${ANALYTICS}/admin/events` })).statusCode,
      ).toBe(403);
    }
  });

  it('refuses it anonymously', async () => {
    expect((await app.inject({ method: 'GET', url: `${ANALYTICS}/admin/overview` })).statusCode).toBe(
      401,
    );
  });

  it('allows a producer and an admin', async () => {
    for (const role of ['PRODUCER', 'ADMIN'] as const) {
      const client = await makeUser(`operator_${role.toLowerCase()}`, role);
      expect(
        (await client.request({ method: 'GET', url: `${ANALYTICS}/admin/overview` })).statusCode,
        role,
      ).toBe(200);
    }
  });

  it('reserves the rebuild for an operator and audits it', async () => {
    const viewer = await makeUser('viewer');
    const producer = await makeUser('producer', 'PRODUCER');

    expect(
      (await viewer.request({ method: 'POST', url: `${ANALYTICS}/admin/rebuild`, payload: { days: 3 } }))
        .statusCode,
    ).toBe(403);

    const allowed = await producer.request({
      method: 'POST',
      url: `${ANALYTICS}/admin/rebuild`,
      payload: { days: 3 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.processed).toBe(3);

    const actions = (await db.auditLog.findMany({ select: { action: true } })).map(
      (row) => row.action,
    );
    expect(actions).toContain('analytics.rebuild');
  });

  it('lets any signed-in user manage their own privacy but nobody else’s', async () => {
    const user = await makeUser('viewer');

    expect(
      (await user.request({ method: 'PATCH', url: `${ANALYTICS}/me/privacy`, payload: { optOut: true } }))
        .statusCode,
    ).toBe(200);

    // There is no route that takes a user id: the setting is always the
    // caller's own.
    const response = await user.request({
      method: 'PATCH',
      url: `${ANALYTICS}/users/${user.userId}/privacy`,
      payload: { optOut: false },
    });
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 8. Aggregation at size
// ---------------------------------------------------------------------------

describe('8. aggregation at size', () => {
  it('aggregates ten thousand events and answers from the aggregates', async () => {
    const users = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        db.user.create({
          data: {
            email: `bulk${index}@test.local`,
            emailNormalized: `bulk${index}@test.local`,
            passwordHash: sharedHash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            profile: { create: { displayName: `bulk${index}` } },
          },
          select: { id: true },
        }),
      ),
    );

    const at = daysAgo(1);
    const names = ['poll_voted', 'poll_viewed', 'prediction_submitted', 'contestant_viewed'] as const;

    await db.analyticsEvent.createMany({
      data: Array.from({ length: 10_000 }, (_, index) => ({
        name: names[index % names.length]!,
        userId: users[index % users.length]!.id,
        properties: { entityId: `entity_${index % 20}` },
        occurredAt: at,
      })),
    });

    const aggregateStart = Date.now();
    await aggregateDay(at);
    await snapshotDay(at);
    const aggregateMs = Date.now() - aggregateStart;

    // The dashboard read is the number that matters: it must not depend on how
    // many raw events there are.
    const readStart = Date.now();
    const overview = await getOverview(30);
    const readMs = Date.now() - readStart;

    expect(overview.summary.length).toBeGreaterThan(0);
    const pollVotes = overview.summary.find((metric) => metric.metric === 'poll_participation');
    expect(pollVotes!.series.reduce((sum, point) => sum + point.value, 0)).toBe(2500);

    const dau = await db.analyticsAggregate.findFirstOrThrow({
      where: { metric: 'dau', date: startOfDayUtc(at) },
    });
    expect(dau.value).toBe(50);

    // Generous ceilings — this asserts the shape of the cost, not a benchmark.
    expect(aggregateMs, `aggregation took ${aggregateMs}ms`).toBeLessThan(20_000);
    expect(readMs, `dashboard read took ${readMs}ms`).toBeLessThan(2_000);
  }, 120_000);

  it('reads a dashboard without touching the raw event log', async () => {
    const user = await makeUser('viewer');
    await track({ name: 'poll_voted', userId: user.userId, entityId: 'p', occurredAt: daysAgo(1) });
    await aggregateRange(2);

    // Delete every raw event. The dashboard is built from aggregates, so it
    // must still answer — which is the structural proof that reads do not scan
    // the log.
    await db.analyticsEvent.deleteMany();

    const overview = await getOverview(7);
    const total = overview.summary
      .find((metric) => metric.metric === 'poll_participation')!
      .series.reduce((sum, point) => sum + point.value, 0);

    expect(total).toBe(1);
  });
});
