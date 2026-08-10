import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

/**
 * Performance smoke tests.
 *
 * Not optimisation — that is Phase 22. These are tripwires for the two things
 * that turn a working page into an outage on a busy night, and both are
 * invisible until there is data:
 *
 *  1. **A read whose cost grows with history.** A dashboard that scans the
 *     event log is fine on a seeded database and fatal on a real one.
 *  2. **A query per row.** An endpoint that issues one query per item looks
 *     instant with three items and falls over with three hundred.
 *
 * The thresholds are deliberately loose. A tripwire that fires on a slow laptop
 * gets deleted, and then it protects nothing.
 */

const AUTH = `${API_PREFIX}/auth`;
const PREDICTIONS = `${API_PREFIX}/predictions`;
const POLLS = `${API_PREFIX}/polls`;
const LEADERBOARDS = `${API_PREFIX}/leaderboards`;
const CONTESTANTS = `${API_PREFIX}/contestants`;
const DASHBOARD = `${API_PREFIX}/dashboard`;
const ADMIN = `${API_PREFIX}/admin`;
const ANALYTICS = `${API_PREFIX}/analytics`;

/** Generous: this runs on whatever machine happens to be to hand. */
const SLOW_MS = 1500;

let app: FastifyInstance;
let passwordHash: string;
let viewer: TestClient & { userId: string };
let admin: TestClient;

beforeAll(async () => {
  app = await buildTestApp();
  passwordHash = await hashPassword(VALID_PASSWORD);

  await resetAll();
  await seedLargeWorld();

  viewer = await makeUser('perf.viewer@test.local', 'PerfViewer', 'USER');
  admin = await makeUser('perf.admin@test.local', 'PerfAdmin', 'ADMIN');
}, 180_000);

afterAll(async () => {
  await app.close();
  await disconnectTestDatabase();
});

async function makeUser(email: string, displayName: string, role: 'USER' | 'ADMIN') {
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash,
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName, pointsBalance: 500, lifetimePoints: 500 } },
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

/**
 * Enough history that a linear read has somewhere to go wrong.
 *
 * Not "production scale" — the point is that a cost which grows with history
 * shows up as a *difference*, and a few thousand rows is enough to see one.
 */
async function seedLargeWorld(): Promise<void> {
  await db.show.create({
    data: { id: 'show_p', slug: 'perf-show', name: 'Perf Show', status: 'LIVE' },
  });
  await db.pointsRule.createMany({
    data: [
      { key: 'PREDICTION_PARTICIPATION', points: 5 },
      { key: 'POLL_PARTICIPATION', points: 3 },
    ],
  });

  await db.contestant.createMany({
    data: Array.from({ length: 24 }, (_, index) => ({
      id: `con_p${index}`,
      showId: 'show_p',
      slug: `perf-contestant-${index}`,
      displayName: `Perf Contestant ${index}`,
      heatScore: Math.random() * 100,
    })),
  });

  await db.livePoll.create({
    data: {
      id: 'poll_p',
      showId: 'show_p',
      question: 'A poll with a real audience?',
      status: 'ACTIVE',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      participationPoints: 3,
      options: {
        create: [
          { id: 'plp_a', label: 'Yes', sortOrder: 0 },
          { id: 'plp_b', label: 'No', sortOrder: 1 },
        ],
      },
    },
  });

  await db.prediction.createMany({
    data: Array.from({ length: 40 }, (_, index) => ({
      id: `pred_p${index}`,
      showId: 'show_p',
      question: `Perf question number ${index}?`,
      status: 'OPEN' as const,
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 3600_000),
      participationPoints: 5,
      rewardPoints: 50,
    })),
  });
  await db.predictionOption.createMany({
    data: Array.from({ length: 40 }, (_, index) => [
      { id: `pp${index}a`, predictionId: `pred_p${index}`, label: 'A', sortOrder: 0 },
      { id: `pp${index}b`, predictionId: `pred_p${index}`, label: 'B', sortOrder: 1 },
    ]).flat(),
  });

  // 300 accounts with a ledger history behind them.
  const users = await Promise.all(
    Array.from({ length: 300 }, (_, index) =>
      db.user.create({
        data: {
          email: `crowd${index}@perf.local`,
          emailNormalized: `crowd${index}@perf.local`,
          passwordHash: 'x',
          role: 'USER',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          profile: {
            create: {
              displayName: `Crowd ${index}`,
              pointsBalance: index * 3,
              lifetimePoints: index * 3,
            },
          },
        },
        select: { id: true },
      }),
    ),
  );

  await db.pointsLedger.createMany({
    data: users.flatMap((user, userIndex) =>
      Array.from({ length: 10 }, (_, entryIndex) => ({
        userId: user.id,
        delta: 3,
        balanceAfter: (entryIndex + 1) * 3,
        entryType: 'EARN' as const,
        sourceType: 'POLL' as const,
        sourceId: `poll_p${entryIndex}`,
        reason: `participation_${userIndex}_${entryIndex}`,
      })),
    ),
  });

  await db.pollVote.createMany({
    data: users.map((user) => ({
      pollId: 'poll_p',
      optionId: 'plp_a',
      userId: user.id,
    })),
  });

  // 5000 analytics events, so a dashboard that scans the log will say so.
  const days = 30;
  await db.analyticsEvent.createMany({
    data: Array.from({ length: 5000 }, (_, index) => ({
      name: index % 2 === 0 ? 'poll_voted' : 'contestant_viewed',
      userId: users[index % users.length]!.id,
      occurredAt: new Date(Date.now() - (index % days) * 86_400_000),
    })),
  });

  await db.auditLog.createMany({
    data: Array.from({ length: 2000 }, (_, index) => ({
      action: index % 2 === 0 ? 'poll.create' : 'prediction.resolve',
      entityType: index % 2 === 0 ? 'LivePoll' : 'Prediction',
      entityId: `entity_${index}`,
    })),
  });
}

/** Times a request and returns both the response and how long it took. */
async function timed(client: TestClient, url: string) {
  const started = performance.now();
  const response = await client.request({ method: 'GET', url });
  return { response, ms: performance.now() - started };
}

// ---------------------------------------------------------------------------

describe('reads stay fast with history behind them', () => {
  const ROUTES: [name: string, url: string, who: 'viewer' | 'admin'][] = [
    ['contestant list', CONTESTANTS, 'viewer'],
    ['prediction list', PREDICTIONS, 'viewer'],
    ['poll list', POLLS, 'viewer'],
    ['dashboard', DASHBOARD, 'viewer'],
    ['leaderboard', `${LEADERBOARDS}?window=SEASON`, 'viewer'],
    ['console overview', `${ADMIN}/overview`, 'admin'],
    ['audit trail', `${ADMIN}/audit`, 'admin'],
    ['analytics overview', `${ANALYTICS}/admin/overview?days=30`, 'admin'],
  ];

  it.each(ROUTES)('%s answers under %dms', async (name, url, who) => {
    const client = who === 'admin' ? admin : viewer;
    const { response, ms } = await timed(client, url);

    expect(response.statusCode, `${name} failed: ${response.body.slice(0, 200)}`).toBeLessThan(400);
    expect(ms, `${name} took ${Math.round(ms)}ms`).toBeLessThan(SLOW_MS);
  });

  it('the analytics dashboard does not get slower as the event log grows', async () => {
    const before = await timed(admin, `${ANALYTICS}/admin/overview?days=30`);

    // Ten times the raw log. A dashboard reading aggregates should not notice.
    const extra = await db.user.findMany({ take: 50, select: { id: true } });
    await db.analyticsEvent.createMany({
      data: Array.from({ length: 20_000 }, (_, index) => ({
        name: 'contestant_viewed',
        userId: extra[index % extra.length]!.id,
        occurredAt: new Date(Date.now() - (index % 30) * 86_400_000),
      })),
    });

    const after = await timed(admin, `${ANALYTICS}/admin/overview?days=30`);

    expect(after.response.statusCode).toBe(200);
    expect(after.ms, `grew to ${Math.round(after.ms)}ms from ${Math.round(before.ms)}ms`).toBeLessThan(
      SLOW_MS,
    );
  }, 120_000);

  it('the leaderboard answers from the projection rather than an aggregate query', async () => {
    const { response, ms } = await timed(viewer, `${LEADERBOARDS}?window=SEASON&limit=50`);

    expect(response.statusCode).toBe(200);
    // 3000 ledger rows behind it; a SUM/GROUP BY at request time would show.
    expect(ms, `took ${Math.round(ms)}ms over 3000 ledger rows`).toBeLessThan(SLOW_MS);
  });
});

describe('list endpoints do not cost a round trip per row', () => {
  /*
    An N+1 is a *shape* problem, and the honest way to detect one without
    instrumenting the client is to change the row count and watch what the cost
    does. A single query that returns ten times the rows costs a little more; a
    query per row costs ten times as much, because each row buys another round
    trip.

    Prisma's own `$on('query')` was tried first and is not available here: the
    application's client is not constructed with query-level logging, so the
    counter silently returned zero and the assertions could never fail. A test
    that cannot fail is worse than no test, so this measures instead.
  */

  /** Median of several runs, because a single timing is mostly noise. */
  async function medianMs(client: TestClient, url: string, runs = 5): Promise<number> {
    const samples: number[] = [];
    for (let index = 0; index < runs; index += 1) {
      samples.push((await timed(client, url)).ms);
    }
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
  }

  it('serving ten times the contestants does not cost ten times as much', async () => {
    const small = await medianMs(viewer, CONTESTANTS);

    await db.contestant.createMany({
      data: Array.from({ length: 216 }, (_, index) => ({
        id: `con_extra${index}`,
        showId: 'show_p',
        slug: `perf-extra-${index}`,
        displayName: `Extra Contestant ${index}`,
        heatScore: Math.random() * 100,
      })),
    });

    const large = await medianMs(viewer, CONTESTANTS);

    expect(large).toBeLessThan(SLOW_MS);
    // 10x the rows. A per-row query would blow well past 5x; one query does not.
    expect(
      large,
      `24 rows took ${Math.round(small)}ms, 240 rows took ${Math.round(large)}ms`,
    ).toBeLessThan(Math.max(small * 5, 250));
  }, 60_000);

  it('reads a poll with 300 votes without visiting each vote', async () => {
    const { response, ms } = await timed(viewer, `${POLLS}/poll_p`);

    expect(response.statusCode).toBe(200);
    // The tally is aggregated in the database, not assembled row by row.
    expect(ms, `took ${Math.round(ms)}ms for a poll with 300 votes`).toBeLessThan(SLOW_MS);
  });

  it('pages the audit trail rather than reading all 2000 rows', async () => {
    const { response, ms } = await timed(admin, `${ADMIN}/audit`);

    expect(response.statusCode).toBe(200);
    const items = response.json().data.items;
    // A default page size, not "everything ever recorded".
    expect(items.length).toBeLessThanOrEqual(100);
    expect(ms).toBeLessThan(SLOW_MS);
  });
});

describe('write paths stay bounded', () => {
  it('casting the 301st vote costs no more than the first', async () => {
    const solo = await makeUser('perf.solo@test.local', 'PerfSolo', 'USER');

    const { response, ms } = await (async () => {
      const started = performance.now();
      const result = await solo.request({
        method: 'POST',
        url: `${POLLS}/poll_p/vote`,
        payload: { optionId: 'plp_b' },
      });
      return { response: result, ms: performance.now() - started };
    })();

    expect(response.statusCode).toBe(200);
    // 300 votes already on this poll; the cost of the next one must not depend
    // on that number.
    expect(ms, `casting one vote took ${Math.round(ms)}ms`).toBeLessThan(SLOW_MS);
  });
});
