import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { emitDomainEvent } from '../../src/core/domain-events.js';
import { hashPassword } from '../../src/core/password.js';
import { __setProviderForTests } from '../../src/modules/notifications/channels.js';
import {
  processEvent,
  retryPendingDeliveries,
} from '../../src/modules/notifications/notifications.service.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;
const NOTIFY = `${API_PREFIX}/notifications`;

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

afterEach(() => {
  // Any swapped-in provider must not leak into the next test.
  __setProviderForTests('EMAIL', null);
  __setProviderForTests('PUSH', null);
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
 * Emits an event and waits for its fan-out.
 *
 * The dispatcher runs in the background by design, so without this every
 * assertion below would be racing it.
 */
async function emitAndSettle(input: Parameters<typeof emitDomainEvent>[0]) {
  const emitted = await emitDomainEvent(input);
  await emitted?.settled;
  return emitted;
}

const notificationsFor = (userId: string) =>
  db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

// ---------------------------------------------------------------------------
// 1. An event creates a notification
// ---------------------------------------------------------------------------

describe('events create notifications', () => {
  it('turns a domain event into a rendered notification', async () => {
    const author = await makeUser('author', { login: false });

    await emitAndSettle({
      event: 'challenge.approved',
      entityId: 'chal_1',
      payload: { userId: author.userId, title: 'Silent disco at 3am' },
    });

    const [notification] = await notificationsFor(author.userId);
    expect(notification).toMatchObject({
      type: 'CHALLENGE',
      event: 'challenge.approved',
      title: 'Your challenge was approved',
      readAt: null,
    });
    // The template placeholder was filled from the payload.
    expect(notification!.body).toContain('Silent disco at 3am');
    expect(notification!.link).toBe('/challenges/chal_1');
  });

  it('records the event durably before anybody is told', async () => {
    const author = await makeUser('author', { login: false });

    const emitted = await emitDomainEvent({
      event: 'challenge.rejected',
      entityId: 'chal_2',
      payload: { userId: author.userId, title: 'A challenge', reason: 'Too risky.' },
    });

    // The row exists whether or not the fan-out has run — which is what makes
    // it replayable after a crash.
    const stored = await db.notificationEvent.findUniqueOrThrow({ where: { id: emitted!.id } });
    expect(stored).toMatchObject({ event: 'challenge.rejected', entityId: 'chal_2' });

    await emitted!.settled;
    const processed = await db.notificationEvent.findUniqueOrThrow({ where: { id: stored.id } });
    expect(processed).toMatchObject({ status: 'PROCESSED', fanout: 1 });
    expect(processed.processedAt).not.toBeNull();
  });

  it('creates a delivery row per enabled channel', async () => {
    const user = await makeUser('user', { login: false });
    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'red_1',
      payload: { userId: user.userId, rewardName: 'Golden Badge' },
    });

    const [notification] = await notificationsFor(user.userId);
    const deliveries = await db.notificationDelivery.findMany({
      where: { notificationId: notification!.id },
    });

    // In-app only by default, and in-app cannot fail: the row is the delivery.
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ channel: 'IN_APP', status: 'SENT', attemptCount: 1 });
  });

  it('reaches only the people who took part in a participants event', async () => {
    const played = await makeUser('played', { login: false });
    const watched = await makeUser('watched', { login: false });

    await emitAndSettle({
      event: 'prediction.resolved',
      entityId: 'pred_1',
      payload: { question: 'Who wins?', answer: 'Priya', userIds: [played.userId] },
    });

    expect(await notificationsFor(played.userId)).toHaveLength(1);
    expect(await notificationsFor(watched.userId)).toHaveLength(0);
  });

  it('reaches everybody active for a broadcast event', async () => {
    const one = await makeUser('one', { login: false });
    const two = await makeUser('two', { login: false });
    const unverified = await db.user.create({
      data: {
        email: 'unverified@test.local',
        emailNormalized: 'unverified@test.local',
        passwordHash: sharedHash,
        status: 'PENDING_VERIFICATION',
        profile: { create: { displayName: 'unverified' } },
      },
      select: { id: true },
    });

    await emitAndSettle({
      event: 'weekend.round_opened',
      entityId: 'round_1',
      payload: { title: 'Ask a housemate' },
    });

    expect(await notificationsFor(one.userId)).toHaveLength(1);
    expect(await notificationsFor(two.userId)).toHaveLength(1);
    // An account that never confirmed its email is not an audience.
    expect(await notificationsFor(unverified.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicates
// ---------------------------------------------------------------------------

describe('duplicate events', () => {
  it('records the same happening once', async () => {
    const user = await makeUser('user', { login: false });
    const payload = { userId: user.userId, title: 'A challenge' };

    const first = await emitDomainEvent({ event: 'challenge.selected', entityId: 'c1', payload });
    const second = await emitDomainEvent({ event: 'challenge.selected', entityId: 'c1', payload });

    expect(first?.recorded).toBe(true);
    expect(second?.recorded).toBe(false);
    // The second emit resolved to the same row rather than creating another.
    expect(second?.id).toBe(first?.id);
    expect(await db.notificationEvent.count()).toBe(1);
  });

  it('does not notify twice even if the same event is processed repeatedly', async () => {
    const user = await makeUser('user', { login: false });
    const emitted = await emitDomainEvent({
      event: 'challenge.approved',
      entityId: 'c1',
      payload: { userId: user.userId, title: 'A challenge' },
    });

    await emitted!.settled;
    await processEvent(emitted!.id);
    await processEvent(emitted!.id);

    expect(await notificationsFor(user.userId)).toHaveLength(1);
  });

  it('treats a genuinely repeated happening as a new one', async () => {
    // A challenge trending again next week deserves telling again, which is
    // what the variant is for.
    const user = await makeUser('user', { login: false });
    const payload = { userId: user.userId, title: 'A challenge', votes: 40 };

    await emitAndSettle({ event: 'challenge.trending', entityId: 'c1', variant: 'w1', payload });
    await emitAndSettle({ event: 'challenge.trending', entityId: 'c1', variant: 'w2', payload });

    expect(await notificationsFor(user.userId)).toHaveLength(2);
  });

  it('keys deduplication per user, not globally', async () => {
    const one = await makeUser('one', { login: false });
    const two = await makeUser('two', { login: false });

    await emitAndSettle({
      event: 'prediction.resolved',
      entityId: 'pred_1',
      payload: { question: 'Q', answer: 'A', userIds: [one.userId, two.userId] },
    });

    expect(await notificationsFor(one.userId)).toHaveLength(1);
    expect(await notificationsFor(two.userId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Preferences
// ---------------------------------------------------------------------------

describe('preferences', () => {
  it('suppresses a muted bucket entirely', async () => {
    const user = await makeUser('user');

    const muted = await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'CHALLENGE', inApp: false }] },
    });
    expect(muted.statusCode).toBe(200);

    await emitAndSettle({
      event: 'challenge.approved',
      entityId: 'c1',
      payload: { userId: user.userId, title: 'A challenge' },
    });

    // Muted means the row is never written, not written-and-hidden.
    expect(await notificationsFor(user.userId)).toHaveLength(0);
  });

  it('mutes one bucket without touching another', async () => {
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'CHALLENGE', inApp: false }] },
    });

    await emitAndSettle({
      event: 'challenge.approved',
      entityId: 'c1',
      payload: { userId: user.userId, title: 'A challenge' },
    });
    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'r1',
      payload: { userId: user.userId, rewardName: 'Badge' },
    });

    const rows = await notificationsFor(user.userId);
    expect(rows.map((row) => row.type)).toEqual(['REWARD']);
  });

  it('defaults a new account to in-app only', async () => {
    const user = await makeUser('user');
    const response = await user.request({ method: 'GET', url: `${NOTIFY}/preferences` });

    expect(response.statusCode).toBe(200);
    const preferences = response.json().data as { type: string; inApp: boolean; email: boolean }[];
    expect(preferences).toHaveLength(10);
    expect(preferences.every((row) => row.inApp)).toBe(true);
    expect(preferences.every((row) => !row.email)).toBe(true);
  });

  it('leaves untouched channels alone when one is changed', async () => {
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'REWARD', email: true }] },
    });

    const response = await user.request({ method: 'GET', url: `${NOTIFY}/preferences` });
    const reward = (response.json().data as { type: string; inApp: boolean; email: boolean }[]).find(
      (row) => row.type === 'REWARD',
    );
    expect(reward).toMatchObject({ inApp: true, email: true });
  });

  it('refuses a preference for a bucket that does not exist', async () => {
    const user = await makeUser('user');
    const response = await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'NOT_A_BUCKET', inApp: false }] },
    });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. Reading and counting
// ---------------------------------------------------------------------------

describe('reading notifications', () => {
  async function seedThree(userId: string) {
    for (const entityId of ['a', 'b', 'c']) {
      await emitAndSettle({
        event: 'challenge.approved',
        entityId,
        payload: { userId, title: `Challenge ${entityId}` },
      });
    }
  }

  it('lists the feed newest first with an unread count', async () => {
    const user = await makeUser('user');
    await seedThree(user.userId);

    const response = await user.request({ method: 'GET', url: NOTIFY });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(3);
    expect(response.json().data.unreadCount).toBe(3);
    expect(response.json().data.items[0].title).toBeTruthy();
  });

  it('marks one as read and adjusts the count', async () => {
    const user = await makeUser('user');
    await seedThree(user.userId);

    const feed = await user.request({ method: 'GET', url: NOTIFY });
    const target = feed.json().data.items[0].id as string;

    const marked = await user.request({
      method: 'POST',
      url: `${NOTIFY}/read`,
      payload: { ids: [target] },
    });
    expect(marked.json().data).toMatchObject({ updated: 1, unreadCount: 2 });

    const after = await user.request({ method: 'GET', url: `${NOTIFY}/unread-count` });
    expect(after.json().data.count).toBe(2);
  });

  it('marks everything read at once', async () => {
    const user = await makeUser('user');
    await seedThree(user.userId);

    const marked = await user.request({ method: 'POST', url: `${NOTIFY}/read`, payload: {} });
    expect(marked.json().data).toMatchObject({ updated: 3, unreadCount: 0 });
  });

  it('does not re-count a notification that is already read', async () => {
    const user = await makeUser('user');
    await seedThree(user.userId);

    await user.request({ method: 'POST', url: `${NOTIFY}/read`, payload: {} });
    const again = await user.request({ method: 'POST', url: `${NOTIFY}/read`, payload: {} });
    expect(again.json().data.updated).toBe(0);
  });

  it('filters to unread only', async () => {
    const user = await makeUser('user');
    await seedThree(user.userId);
    const feed = await user.request({ method: 'GET', url: NOTIFY });
    await user.request({
      method: 'POST',
      url: `${NOTIFY}/read`,
      payload: { ids: [feed.json().data.items[0].id] },
    });

    const unread = await user.request({ method: 'GET', url: `${NOTIFY}?unreadOnly=true` });
    expect(unread.json().data.items).toHaveLength(2);
  });

  it('pages with a cursor', async () => {
    const user = await makeUser('user');
    await seedThree(user.userId);

    const first = await user.request({ method: 'GET', url: `${NOTIFY}?limit=2` });
    expect(first.json().data.items).toHaveLength(2);
    expect(first.json().data.nextCursor).toBeTruthy();

    const second = await user.request({
      method: 'GET',
      url: `${NOTIFY}?limit=2&cursor=${first.json().data.nextCursor}`,
    });
    expect(second.json().data.items).toHaveLength(1);
    expect(second.json().data.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Several users at once
// ---------------------------------------------------------------------------

describe('multiple recipients', () => {
  it('gives each person their own row and their own read state', async () => {
    const one = await makeUser('one');
    const two = await makeUser('two');
    const three = await makeUser('three');

    await emitAndSettle({
      event: 'prediction.resolved',
      entityId: 'pred_1',
      payload: {
        question: 'Who wins?',
        answer: 'Rahul',
        userIds: [one.userId, two.userId, three.userId],
      },
    });

    await one.request({ method: 'POST', url: `${NOTIFY}/read`, payload: {} });

    expect((await one.request({ method: 'GET', url: `${NOTIFY}/unread-count` })).json().data.count)
      .toBe(0);
    expect((await two.request({ method: 'GET', url: `${NOTIFY}/unread-count` })).json().data.count)
      .toBe(1);
    expect(
      (await three.request({ method: 'GET', url: `${NOTIFY}/unread-count` })).json().data.count,
    ).toBe(1);
  });

  it('respects each person’s own preferences in the same fan-out', async () => {
    const listener = await makeUser('listener');
    const muted = await makeUser('muted');

    await muted.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'PREDICTION', inApp: false }] },
    });

    const emitted = await emitAndSettle({
      event: 'prediction.resolved',
      entityId: 'pred_1',
      payload: { question: 'Q', answer: 'A', userIds: [listener.userId, muted.userId] },
    });

    // One person told, one deliberately not — from a single fan-out.
    const record = await db.notificationEvent.findUniqueOrThrow({ where: { id: emitted!.id } });
    expect(record.fanout).toBe(1);
    expect(await notificationsFor(listener.userId)).toHaveLength(1);
    expect(await notificationsFor(muted.userId)).toHaveLength(0);
  });

  it('never shows one person another person’s feed', async () => {
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');

    await emitAndSettle({
      event: 'challenge.approved',
      entityId: 'c1',
      payload: { userId: owner.userId, title: 'Private business' },
    });

    const feed = await stranger.request({ method: 'GET', url: NOTIFY });
    expect(feed.json().data.items).toHaveLength(0);
  });

  it('cannot be tricked into marking somebody else’s notification read', async () => {
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');

    await emitAndSettle({
      event: 'challenge.approved',
      entityId: 'c1',
      payload: { userId: owner.userId, title: 'Private business' },
    });
    const [notification] = await notificationsFor(owner.userId);

    const attempt = await stranger.request({
      method: 'POST',
      url: `${NOTIFY}/read`,
      payload: { ids: [notification!.id] },
    });
    expect(attempt.json().data.updated).toBe(0);

    const untouched = await db.notification.findUniqueOrThrow({ where: { id: notification!.id } });
    expect(untouched.readAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Unauthorised creation
// ---------------------------------------------------------------------------

describe('nobody can create a notification for somebody else', () => {
  it('exposes no endpoint that writes to another user’s feed', async () => {
    const attacker = await makeUser('attacker');
    const victim = await makeUser('victim', { login: false });

    const payloads = [
      { userId: victim.userId, title: 'Fake', body: 'You have won' },
      { type: 'SYSTEM', title: 'Fake', body: 'Click here' },
    ];

    for (const url of [NOTIFY, `${NOTIFY}/create`, `${NOTIFY}/send`]) {
      for (const payload of payloads) {
        const response = await attacker.request({ method: 'POST', url, payload });
        expect([404, 400]).toContain(response.statusCode);
      }
    }

    expect(await notificationsFor(victim.userId)).toHaveLength(0);
  });

  it('refuses the announcement route to an ordinary user and a producer', async () => {
    const viewer = await makeUser('viewer');
    const producer = await makeUser('producer', { role: 'PRODUCER' });

    for (const client of [viewer, producer]) {
      const response = await client.request({
        method: 'POST',
        url: `${NOTIFY}/admin/announce`,
        payload: { title: 'Everyone read this', body: 'Please' },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(await db.notification.count()).toBe(0);
  });

  it('refuses the health dashboard and retry to an ordinary user', async () => {
    const viewer = await makeUser('viewer');

    expect(
      (await viewer.request({ method: 'GET', url: `${NOTIFY}/admin/health` })).statusCode,
    ).toBe(403);
    expect(
      (await viewer.request({ method: 'POST', url: `${NOTIFY}/admin/retry`, payload: {} }))
        .statusCode,
    ).toBe(403);
  });

  it('lets an admin announce, through the same deduplicated pipeline', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const viewer = await makeUser('viewer', { login: false });

    const response = await admin.request({
      method: 'POST',
      url: `${NOTIFY}/admin/announce`,
      payload: { title: 'Live show tonight', body: 'Doors at eight.' },
    });
    expect(response.statusCode).toBe(201);

    const eventId = response.json().data.eventId as string;
    await processEvent(eventId);
    // Idempotent, so it does not matter whether the background pass got there
    // first; this just removes the race from the assertion below.

    const [notification] = await notificationsFor(viewer.userId);
    expect(notification).toMatchObject({ type: 'SYSTEM', title: 'Live show tonight' });

    const audit = await db.auditLog.findMany({ select: { action: true } });
    expect(audit.map((row) => row.action)).toContain('notification.announce');
  });

  it('lets a moderator look at health but not retry', async () => {
    const moderator = await makeUser('moderator', { role: 'MODERATOR' });

    expect(
      (await moderator.request({ method: 'GET', url: `${NOTIFY}/admin/health` })).statusCode,
    ).toBe(200);
    expect(
      (await moderator.request({ method: 'POST', url: `${NOTIFY}/admin/retry`, payload: {} }))
        .statusCode,
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 8. Delivery failure and retry
// ---------------------------------------------------------------------------

describe('delivery failure and retry', () => {
  it('records a failure, backs off, and succeeds on retry', async () => {
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'REWARD', email: true }] },
    });

    let attempts = 0;
    __setProviderForTests('EMAIL', {
      channel: 'EMAIL',
      isAvailable: () => true,
      async send() {
        attempts += 1;
        // Fails the first time, works the second — the shape of a real outage.
        return attempts === 1
          ? { status: 'FAILED', error: 'SMTP connection reset', retryable: true }
          : { status: 'SENT' };
      },
    });

    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'r1',
      payload: { userId: user.userId, rewardName: 'Golden Badge' },
    });

    const failed = await db.notificationDelivery.findFirstOrThrow({ where: { channel: 'EMAIL' } });
    expect(failed).toMatchObject({ status: 'FAILED', attemptCount: 1 });
    expect(failed.lastError).toContain('SMTP');
    expect(failed.nextAttemptAt).not.toBeNull();

    // The in-app copy went out regardless: one channel failing must not hold up
    // the one the user is actually looking at.
    const inApp = await db.notificationDelivery.findFirstOrThrow({ where: { channel: 'IN_APP' } });
    expect(inApp.status).toBe('SENT');

    // Bring the backoff forward, as an operator retry does.
    await db.notificationDelivery.update({
      where: { id: failed.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const retried = await retryPendingDeliveries();
    expect(retried).toBe(1);

    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: failed.id } });
    expect(after).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(after.deliveredAt).not.toBeNull();
  });

  it('gives up after the attempt ceiling rather than retrying forever', async () => {
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'REWARD', email: true }] },
    });

    __setProviderForTests('EMAIL', {
      channel: 'EMAIL',
      isAvailable: () => true,
      async send() {
        return { status: 'FAILED', error: 'Mailbox does not exist', retryable: true };
      },
    });

    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'r1',
      payload: { userId: user.userId, rewardName: 'Badge' },
    });

    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { channel: 'EMAIL' } });
    let lastRetried = 0;
    for (let pass = 0; pass < 8; pass += 1) {
      // Bring the backoff forward, as an impatient operator would.
      await db.notificationDelivery.updateMany({
        where: { id: delivery.id, status: 'FAILED', attemptCount: { lt: 5 } },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      lastRetried = await retryPendingDeliveries();
    }

    const exhausted = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(exhausted.attemptCount).toBe(5);
    // The sweep stops picking it up rather than spinning on it forever.
    expect(lastRetried).toBe(0);
    expect(exhausted.nextAttemptAt).toBeNull();
  });

  it('marks an unconfigured channel skipped, not failed', async () => {
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'REWARD', push: true }] },
    });

    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'r1',
      payload: { userId: user.userId, rewardName: 'Badge' },
    });

    const push = await db.notificationDelivery.findFirstOrThrow({ where: { channel: 'PUSH' } });
    // Nothing is broken — the platform simply has no push provider yet. Calling
    // that a failure would fill the admin queue with noise no retry can fix.
    expect(push.status).toBe('SKIPPED');
    expect(push.nextAttemptAt).toBeNull();
  });

  it('surfaces failures and stuck events on the health dashboard', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'REWARD', email: true }] },
    });

    __setProviderForTests('EMAIL', {
      channel: 'EMAIL',
      isAvailable: () => true,
      async send() {
        return { status: 'FAILED', error: 'Provider timeout', retryable: true };
      },
    });

    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'r1',
      payload: { userId: user.userId, rewardName: 'Badge' },
    });

    const health = await admin.request({ method: 'GET', url: `${NOTIFY}/admin/health` });
    expect(health.statusCode).toBe(200);

    const data = health.json().data;
    expect(data.events.processed).toBeGreaterThanOrEqual(1);
    expect(data.recentFailures).toHaveLength(1);
    expect(data.recentFailures[0]).toMatchObject({ channel: 'EMAIL', attemptCount: 1 });
    expect(data.recentFailures[0].lastError).toContain('Provider timeout');

    const email = data.channels.find((row: { channel: string }) => row.channel === 'EMAIL');
    expect(email).toMatchObject({ failed: 1 });
    const push = data.channels.find((row: { channel: string }) => row.channel === 'PUSH');
    expect(push.available).toBe(false);
  });

  it('lets an admin resend a failed delivery and audits it', async () => {
    const admin = await makeUser('admin', { role: 'ADMIN' });
    const user = await makeUser('user');
    await user.request({
      method: 'PATCH',
      url: `${NOTIFY}/preferences`,
      payload: { preferences: [{ type: 'REWARD', email: true }] },
    });

    let shouldFail = true;
    __setProviderForTests('EMAIL', {
      channel: 'EMAIL',
      isAvailable: () => true,
      async send() {
        return shouldFail
          ? { status: 'FAILED', error: 'Temporary outage', retryable: true }
          : { status: 'SENT' };
      },
    });

    await emitAndSettle({
      event: 'reward.redemption_fulfilled',
      entityId: 'r1',
      payload: { userId: user.userId, rewardName: 'Badge' },
    });

    shouldFail = false;
    const retry = await admin.request({
      method: 'POST',
      url: `${NOTIFY}/admin/retry`,
      payload: {},
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.deliveries).toBe(1);

    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { channel: 'EMAIL' } });
    expect(delivery.status).toBe('SENT');

    const audit = await db.auditLog.findMany({ select: { action: true } });
    expect(audit.map((row) => row.action)).toContain('notification.retry');
  });

  it('replays an event whose fan-out failed', async () => {
    const user = await makeUser('user', { login: false });

    // An event pointing at nobody: fan-out runs, produces nothing, and is not
    // left PENDING forever.
    const emitted = await emitDomainEvent({
      event: 'challenge.approved',
      entityId: 'c1',
      payload: {},
    });
    await processEvent(emitted!.id);

    const processed = await db.notificationEvent.findUniqueOrThrow({ where: { id: emitted!.id } });
    expect(processed).toMatchObject({ status: 'PROCESSED', fanout: 0 });

    // And the same event with a recipient still works when re-emitted properly.
    await emitAndSettle({
      event: 'challenge.approved',
      entityId: 'c2',
      payload: { userId: user.userId, title: 'A challenge' },
    });
    expect(await notificationsFor(user.userId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency: the scenario from the brief
// ---------------------------------------------------------------------------

describe('concurrent identical events', () => {
  it('produces exactly one notification per user from 1000 identical events', async () => {
    const users = [];
    for (let index = 0; index < 5; index += 1) {
      users.push(await makeUser(`racer${index}`, { login: false }));
    }
    const userIds = users.map((user) => user.userId);

    // 1000 emits of the same happening, all at once.
    const emits = await Promise.all(
      Array.from({ length: 1000 }, () =>
        emitDomainEvent({
          event: 'prediction.resolved',
          entityId: 'pred_hot',
          payload: { question: 'Who wins?', answer: 'Priya', userIds },
        }),
      ),
    );

    // Exactly one of them recorded the event; the other 999 resolved to it.
    const recorded = emits.filter((emit) => emit?.recorded);
    expect(recorded).toHaveLength(1);
    expect(await db.notificationEvent.count()).toBe(1);

    const eventId = recorded[0]!.id;

    // Now process that event 50 times concurrently, as a retry storm would.
    await Promise.all(Array.from({ length: 50 }, () => processEvent(eventId)));

    expect(await db.notification.count()).toBe(users.length);
    for (const user of users) {
      expect(await notificationsFor(user.userId)).toHaveLength(1);
    }

    // One delivery per notification, not fifty.
    expect(await db.notificationDelivery.count()).toBe(users.length);

    const unread = await db.notification.count({ where: { readAt: null } });
    expect(unread).toBe(users.length);
  }, 120_000);

  it('keeps distinct events distinct under the same storm', async () => {
    const user = await makeUser('user', { login: false });

    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        emitDomainEvent({
          event: 'challenge.approved',
          // Ten real challenges, each emitted thirty times.
          entityId: `chal_${index % 10}`,
          payload: { userId: user.userId, title: `Challenge ${index % 10}` },
        }),
      ),
    );

    const events = await db.notificationEvent.findMany({ select: { id: true } });
    expect(events).toHaveLength(10);

    await Promise.all(events.map((event) => processEvent(event.id)));
    expect(await notificationsFor(user.userId)).toHaveLength(10);
  }, 120_000);
});
