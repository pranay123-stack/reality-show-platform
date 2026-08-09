import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { signAccessToken } from '../../src/core/auth/jwt.js';
import { hashPassword } from '../../src/core/password.js';
import { attachRealtime, shutdownRealtime } from '../../src/realtime/server.js';
import { VALID_PASSWORD } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

/**
 * Realtime tests run against a **real listening server** with real socket
 * clients. Nothing here is mocked: reconnection, acks and room fan-out only
 * mean something if the transport is genuine.
 */

let app: FastifyInstance;
let baseUrl: string;
const openSockets: Socket[] = [];

beforeAll(async () => {
  app = await buildApp({ minimal: true });
  await attachRealtime(app);
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await shutdownRealtime();
  await app.close();
  await disconnectTestDatabase();
});

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.disconnect();
});

/** Creates a user and returns a signed access token for the socket handshake. */
async function makeUserToken(
  email: string,
  displayName: string,
  options: { role?: 'USER' | 'PRODUCER'; verified?: boolean } = {},
) {
  const user = await db.user.create({
    data: {
      email,
      emailNormalized: email,
      passwordHash: await hashPassword(VALID_PASSWORD),
      role: options.role ?? 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: options.verified === false ? null : new Date(),
      profile: { create: { displayName } },
    },
  });

  const session = await db.userSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: `hash_${user.id}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });

  const { token } = await signAccessToken({
    userId: user.id,
    sessionId: session.id,
    role: options.role ?? 'USER',
  });

  return { userId: user.id, sessionId: session.id, token };
}

/**
 * `connection:ready` is emitted by the server the instant the socket connects,
 * so a listener attached after `connect` resolves has already missed it. The
 * helper therefore resolves *on* that frame and stashes it for the caller.
 */
const readyFrames = new WeakMap<Socket, { userId: string | null; serverTime: string }>();

function readyOf(socket: Socket): { userId: string | null; serverTime: string } {
  const frame = readyFrames.get(socket);
  if (!frame) throw new Error('connection:ready was never captured for this socket');
  return frame;
}

function connect(token?: string): Promise<Socket> {
  const socket = ioClient(`${baseUrl}/live`, {
    transports: ['websocket'],
    ...(token ? { auth: { token } } : {}),
    reconnection: false,
    forceNew: true,
  });
  openSockets.push(socket);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timed out')), 8000);

    socket.once('connection:ready', (payload: { userId: string | null; serverTime: string }) => {
      clearTimeout(timer);
      readyFrames.set(socket, payload);
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timed out`)), 8000);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function seedActivePoll(durationMs = 60_000) {
  return db.livePoll.create({
    data: {
      id: 'poll_live',
      showId: 'show_test',
      question: 'Who takes the last spot?',
      status: 'ACTIVE',
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + durationMs),
      durationSeconds: Math.round(durationMs / 1000),
      participationPoints: 3,
      options: {
        create: [
          { id: 'popt_1', label: 'Option one', sortOrder: 0 },
          { id: 'popt_2', label: 'Option two', sortOrder: 1 },
        ],
      },
    },
  });
}

beforeEach(async () => {
  await resetAll();
  await db.show.create({
    data: { id: 'show_test', slug: 'test-show', name: 'Test Show', status: 'LIVE' },
  });
  await db.pointsRule.create({ data: { key: 'POLL_PARTICIPATION', points: 3 } });
});

// ---------------------------------------------------------------------------

describe('socket connection', () => {
  it('accepts an anonymous spectator but tells it who it is not', async () => {
    const socket = await connect();
    expect(readyOf(socket).userId).toBeNull();
  });

  it('resolves the signed-in user from the handshake token', async () => {
    const { token, userId } = await makeUserToken('viewer@test.local', 'Viewer');
    const socket = await connect(token);
    expect(readyOf(socket).userId).toBe(userId);
  });

  it('treats a revoked session as anonymous', async () => {
    const { token, sessionId } = await makeUserToken('viewer@test.local', 'Viewer');
    await db.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

    const socket = await connect(token);
    expect(readyOf(socket).userId).toBeNull();
  });

  it('ignores a forged token instead of trusting it', async () => {
    const socket = await connect('not.a.real.token');
    expect(readyOf(socket).userId).toBeNull();
  });
});

describe('joining a poll', () => {
  it('returns authoritative state, with counts withheld before you vote', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('viewer@test.local', 'Viewer');
    const socket = await connect(token);

    const ack = await emitWithAck<{ ok: boolean; poll: { counts: unknown; version: number }; myOptionId: string | null }>(
      socket,
      'poll:join',
      { pollId: 'poll_live' },
    );

    expect(ack.ok).toBe(true);
    expect(ack.myOptionId).toBeNull();
    expect(ack.poll.counts).toBeNull();
    expect(typeof ack.poll.version).toBe('number');
  });

  it('answers cleanly for a poll that does not exist', async () => {
    const socket = await connect();
    const ack = await emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:join', {
      pollId: 'nope',
    });
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('NOT_FOUND');
  });
});

describe('voting over the socket', () => {
  it('records a vote and returns the authoritative tally in the ack', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('viewer@test.local', 'Viewer');
    const socket = await connect(token);
    await emitWithAck(socket, 'poll:join', { pollId: 'poll_live' });

    const ack = await emitWithAck<{
      ok: boolean;
      totalVotes: number;
      counts: { optionId: string; voteCount: number }[];
      pointsAwarded: number;
    }>(socket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    expect(ack.ok).toBe(true);
    expect(ack.totalVotes).toBe(1);
    expect(ack.counts.find((c) => c.optionId === 'popt_1')?.voteCount).toBe(1);
    expect(ack.pointsAwarded).toBe(3);
  });

  it('refuses a duplicate vote from the same user', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('viewer@test.local', 'Viewer');
    const socket = await connect(token);

    await emitWithAck(socket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });
    const second = await emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
      pollId: 'poll_live',
      optionId: 'popt_2',
    });

    expect(second.ok).toBe(false);
    expect(second.code).toBe('VOTE_DUPLICATE');

    const poll = await db.livePoll.findUniqueOrThrow({ where: { id: 'poll_live' } });
    expect(poll.totalVotes).toBe(1);
    expect(await db.pollVote.count()).toBe(1);
  });

  it('refuses an anonymous vote', async () => {
    await seedActivePoll();
    const socket = await connect();

    const ack = await emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
      pollId: 'poll_live',
      optionId: 'popt_1',
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('UNAUTHENTICATED');
    expect(await db.pollVote.count()).toBe(0);
  });

  it('refuses a vote from an unverified account', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('new@test.local', 'NewUser', { verified: false });
    const socket = await connect(token);

    const ack = await emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
      pollId: 'poll_live',
      optionId: 'popt_1',
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('refuses a vote on a closed poll', async () => {
    await seedActivePoll();
    await db.livePoll.update({ where: { id: 'poll_live' }, data: { status: 'CLOSED' } });

    const { token } = await makeUserToken('viewer@test.local', 'Viewer');
    const socket = await connect(token);

    const ack = await emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
      pollId: 'poll_live',
      optionId: 'popt_1',
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('POLL_CLOSED');
  });

  it('refuses a vote once the deadline has passed, even while the status still says ACTIVE', async () => {
    await seedActivePoll(-1000);
    const { token } = await makeUserToken('viewer@test.local', 'Viewer');
    const socket = await connect(token);

    const ack = await emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
      pollId: 'poll_live',
      optionId: 'popt_1',
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('POLL_CLOSED');
    expect(await db.pollVote.count()).toBe(0);
  });
});

describe('multiple concurrent users', () => {
  it('counts every vote exactly once under simultaneous load', async () => {
    await seedActivePoll();

    const voters = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        makeUserToken(`voter${index}@test.local`, `Voter${index}`),
      ),
    );
    const sockets = await Promise.all(voters.map((voter) => connect(voter.token)));

    // All twelve vote at once, split across the two options.
    const acks = await Promise.all(
      sockets.map((socket, index) =>
        emitWithAck<{ ok: boolean }>(socket, 'poll:vote', {
          pollId: 'poll_live',
          optionId: index % 2 === 0 ? 'popt_1' : 'popt_2',
        }),
      ),
    );

    expect(acks.every((ack) => ack.ok)).toBe(true);

    const poll = await db.livePoll.findUniqueOrThrow({
      where: { id: 'poll_live' },
      include: { options: true },
    });

    expect(poll.totalVotes).toBe(12);
    expect(await db.pollVote.count()).toBe(12);

    const byOption = Object.fromEntries(poll.options.map((o) => [o.id, o.voteCount]));
    expect(byOption.popt_1).toBe(6);
    expect(byOption.popt_2).toBe(6);
    // The cached total must equal the sum of the per-option counts.
    expect(byOption.popt_1! + byOption.popt_2!).toBe(poll.totalVotes);
  });

  it('lets the same user hammer the vote button without double-counting', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('spammer@test.local', 'Spammer');
    const socket = await connect(token);

    const acks = await Promise.all(
      Array.from({ length: 8 }, () =>
        emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
          pollId: 'poll_live',
          optionId: 'popt_1',
        }),
      ),
    );

    expect(acks.filter((ack) => ack.ok)).toHaveLength(1);
    expect(acks.filter((ack) => ack.code === 'VOTE_DUPLICATE')).toHaveLength(7);

    const poll = await db.livePoll.findUniqueOrThrow({
      where: { id: 'poll_live' },
      include: { options: true },
    });
    expect(poll.totalVotes).toBe(1);
    expect(poll.options.find((o) => o.id === 'popt_1')?.voteCount).toBe(1);
  });

  it('broadcasts the tally to other clients in the poll room', async () => {
    await seedActivePoll();
    const voter = await makeUserToken('voter@test.local', 'Voter');
    const watcher = await makeUserToken('watcher@test.local', 'Watcher');

    const voterSocket = await connect(voter.token);
    const watcherSocket = await connect(watcher.token);
    await emitWithAck(watcherSocket, 'poll:join', { pollId: 'poll_live' });

    const updatePromise = waitFor<{ pollId: string; totalVotes: number; version: number }>(
      watcherSocket,
      'poll:updated',
    );

    await emitWithAck(voterSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    const update = await updatePromise;
    expect(update.pollId).toBe('poll_live');
    expect(update.totalVotes).toBe(1);
    expect(update.version).toBeGreaterThan(0);
  });

  it('coalesces a burst into far fewer broadcasts than there were votes', async () => {
    await seedActivePoll();

    const watcherToken = await makeUserToken('watcher@test.local', 'Watcher');
    const watcherSocket = await connect(watcherToken.token);
    await emitWithAck(watcherSocket, 'poll:join', { pollId: 'poll_live' });

    let frames = 0;
    watcherSocket.on('poll:updated', () => {
      frames += 1;
    });

    const voters = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        makeUserToken(`voter${index}@test.local`, `Voter${index}`),
      ),
    );
    const sockets = await Promise.all(voters.map((voter) => connect(voter.token)));
    await Promise.all(
      sockets.map((socket) =>
        emitWithAck(socket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' }),
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 800));

    // Ten votes must not mean ten fan-outs. The exact number depends on how the
    // burst lands across ticks; the guarantee is that it is well under the
    // vote count while the final state is still correct.
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(10);

    const poll = await db.livePoll.findUniqueOrThrow({ where: { id: 'poll_live' } });
    expect(poll.totalVotes).toBe(10);
  });
});

describe('closing races', () => {
  it('never half-applies a vote that lands as the poll closes', async () => {
    await seedActivePoll();

    const voters = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        makeUserToken(`racer${index}@test.local`, `Racer${index}`),
      ),
    );
    const sockets = await Promise.all(voters.map((voter) => connect(voter.token)));

    // Fire the votes and the close simultaneously.
    const { closePoll } = await import('../../src/modules/polls/polls.service.js');
    const results = await Promise.all([
      ...sockets.map((socket) =>
        emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
          pollId: 'poll_live',
          optionId: 'popt_1',
        }),
      ),
      closePoll('poll_live'),
    ]);

    const acks = results.slice(0, sockets.length) as { ok: boolean; code?: string }[];
    const accepted = acks.filter((ack) => ack.ok).length;
    const rejected = acks.filter((ack) => !ack.ok).length;

    expect(accepted + rejected).toBe(10);
    // Every rejection must be for the right reason — not a crash or a timeout.
    expect(acks.filter((ack) => !ack.ok).every((ack) => ack.code === 'POLL_CLOSED')).toBe(true);

    const poll = await db.livePoll.findUniqueOrThrow({
      where: { id: 'poll_live' },
      include: { options: true },
    });

    // The decisive assertion: stored state agrees with what clients were told.
    expect(poll.status).toBe('CLOSED');
    expect(await db.pollVote.count()).toBe(accepted);
    expect(poll.totalVotes).toBe(accepted);
    expect(poll.options.find((o) => o.id === 'popt_1')?.voteCount).toBe(accepted);
  });

  it('closes idempotently', async () => {
    await seedActivePoll();
    const { closePoll } = await import('../../src/modules/polls/polls.service.js');

    const first = await closePoll('poll_live');
    const second = await closePoll('poll_live');

    expect(first.alreadyClosed).toBe(false);
    expect(second.alreadyClosed).toBe(true);
    expect(second.poll.closedAt?.getTime()).toBe(first.poll.closedAt?.getTime());
  });

  it('rejects every vote once closed, with no partial writes left behind', async () => {
    await seedActivePoll();
    const { closePoll } = await import('../../src/modules/polls/polls.service.js');
    await closePoll('poll_live');

    const voters = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        makeUserToken(`late${index}@test.local`, `Late${index}`),
      ),
    );
    const sockets = await Promise.all(voters.map((voter) => connect(voter.token)));

    const acks = await Promise.all(
      sockets.map((socket) =>
        emitWithAck<{ ok: boolean; code?: string }>(socket, 'poll:vote', {
          pollId: 'poll_live',
          optionId: 'popt_1',
        }),
      ),
    );

    expect(acks.every((ack) => !ack.ok && ack.code === 'POLL_CLOSED')).toBe(true);

    const poll = await db.livePoll.findUniqueOrThrow({ where: { id: 'poll_live' } });
    expect(poll.totalVotes).toBe(0);
    expect(await db.pollVote.count()).toBe(0);
    // No points were paid for a vote that never counted.
    expect(await db.pointsLedger.count()).toBe(0);
  });
});

describe('reconnect and recovery', () => {
  it('re-syncs authoritative state on rejoin, including the vote already cast', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('viewer@test.local', 'Viewer');

    const first = await connect(token);
    await emitWithAck(first, 'poll:join', { pollId: 'poll_live' });
    await emitWithAck(first, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_2' });
    first.disconnect();

    // A brand-new socket, exactly as a client would create after dropping.
    const second = await connect(token);
    const ack = await emitWithAck<{
      ok: boolean;
      myOptionId: string | null;
      poll: { totalVotes: number; counts: { optionId: string; voteCount: number }[] | null };
    }>(second, 'poll:join', { pollId: 'poll_live' });

    expect(ack.ok).toBe(true);
    expect(ack.myOptionId).toBe('popt_2');
    expect(ack.poll.totalVotes).toBe(1);
    // Having voted, this client is now allowed to see the tally.
    expect(ack.poll.counts).not.toBeNull();
  });

  it('keeps receiving broadcasts after a reconnect', async () => {
    await seedActivePoll();
    const watcher = await makeUserToken('watcher@test.local', 'Watcher');
    const voter = await makeUserToken('voter@test.local', 'Voter');

    const firstWatcher = await connect(watcher.token);
    await emitWithAck(firstWatcher, 'poll:join', { pollId: 'poll_live' });
    firstWatcher.disconnect();

    const rejoined = await connect(watcher.token);
    await emitWithAck(rejoined, 'poll:join', { pollId: 'poll_live' });

    const updatePromise = waitFor<{ totalVotes: number }>(rejoined, 'poll:updated');

    const voterSocket = await connect(voter.token);
    await emitWithAck(voterSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    expect((await updatePromise).totalVotes).toBe(1);
  });

  it('answers a heartbeat so a client can detect a stale connection', async () => {
    const socket = await connect();
    const response = await new Promise<{ serverTime: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ping timed out')), 5000);
      socket.emit('ping', (payload: { serverTime: string }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    expect(() => new Date(response.serverTime).toISOString()).not.toThrow();
  });

  it('stops delivering to a client that left the room', async () => {
    await seedActivePoll();
    const watcher = await makeUserToken('watcher@test.local', 'Watcher');
    const voter = await makeUserToken('voter@test.local', 'Voter');

    const watcherSocket = await connect(watcher.token);
    await emitWithAck(watcherSocket, 'poll:join', { pollId: 'poll_live' });
    watcherSocket.emit('poll:leave', { pollId: 'poll_live' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    let received = 0;
    watcherSocket.on('poll:updated', () => {
      received += 1;
    });

    const voterSocket = await connect(voter.token);
    await emitWithAck(voterSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(received).toBe(0);
  });
});

describe('lifecycle broadcasts over HTTP', () => {
  it('emits poll:started to the show room when a producer activates', async () => {
    await db.livePoll.create({
      data: {
        id: 'poll_draft',
        showId: 'show_test',
        question: 'Ready to start?',
        status: 'DRAFT',
        durationSeconds: 60,
        options: { create: [{ label: 'Yes' }, { label: 'No' }] },
      },
    });

    const producer = await makeUserToken('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const spectator = await connect();

    const startedPromise = waitFor<{ poll: { id: string; counts: unknown } }>(
      spectator,
      'poll:started',
      8000,
    );
    // Anyone can spectate the show room.
    spectator.emit('poll:join', { pollId: 'poll_draft' }, () => undefined);

    const { rooms } = await import('../../src/realtime/events.js');
    const { liveNamespace } = await import('../../src/realtime/server.js');
    // Join the show room the way a real client would on `show:subscribe`.
    liveNamespace()?.sockets.forEach((socket) => void socket.join(rooms.show('show_test')));

    const response = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_draft/activate`,
      headers: { authorization: `Bearer ${producer.token}` },
    });

    expect(response.statusCode).toBe(200);
    const started = await startedPromise;
    expect(started.poll.id).toBe('poll_draft');
    // The start frame withholds counts — nothing to reveal, and nothing to leak.
    expect(started.poll.counts).toBeNull();
  });

  it('emits poll:closed and then poll:result with a winner', async () => {
    await seedActivePoll();
    const producer = await makeUserToken('producer@test.local', 'Producer', { role: 'PRODUCER' });
    const voter = await makeUserToken('voter@test.local', 'Voter');

    const voterSocket = await connect(voter.token);
    await emitWithAck(voterSocket, 'poll:join', { pollId: 'poll_live' });
    await emitWithAck(voterSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    const closedPromise = waitFor<{ pollId: string }>(voterSocket, 'poll:closed');
    const closeResponse = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_live/close`,
      headers: { authorization: `Bearer ${producer.token}` },
    });
    expect(closeResponse.statusCode).toBe(200);
    expect((await closedPromise).pollId).toBe('poll_live');

    const resultPromise = waitFor<{ winningOptionId: string | null; totalVotes: number }>(
      voterSocket,
      'poll:result',
    );
    const publishResponse = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_live/publish`,
      headers: { authorization: `Bearer ${producer.token}` },
    });
    expect(publishResponse.statusCode).toBe(200);

    const result = await resultPromise;
    expect(result.winningOptionId).toBe('popt_1');
    expect(result.totalVotes).toBe(1);
  });

  it('refuses lifecycle actions to an ordinary user', async () => {
    await seedActivePoll();
    const { token } = await makeUserToken('viewer@test.local', 'Viewer');

    const response = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_live/close`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('reports no winner on a tie rather than picking one', async () => {
    await seedActivePoll();
    const producer = await makeUserToken('producer@test.local', 'Producer', { role: 'PRODUCER' });

    const one = await makeUserToken('one@test.local', 'One');
    const two = await makeUserToken('two@test.local', 'Two');
    const socketOne = await connect(one.token);
    const socketTwo = await connect(two.token);
    await emitWithAck(socketOne, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });
    await emitWithAck(socketTwo, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_2' });

    await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_live/close`,
      headers: { authorization: `Bearer ${producer.token}` },
    });
    const published = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_live/publish`,
      headers: { authorization: `Bearer ${producer.token}` },
    });

    expect(published.json().data.winningOptionId).toBeNull();
  });
});

describe('tally confidentiality', () => {
  it('never puts the per-option split on the wire for a client that has not voted', async () => {
    await seedActivePoll();
    const voter = await makeUserToken('voter@test.local', 'Voter');
    const spectator = await makeUserToken('spectator@test.local', 'Spectator');

    const voterSocket = await connect(voter.token);
    const spectatorSocket = await connect(spectator.token);
    await emitWithAck(spectatorSocket, 'poll:join', { pollId: 'poll_live' });

    const frame = waitFor<{ counts: unknown; totalVotes: number }>(spectatorSocket, 'poll:updated');
    await emitWithAck(voterSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    const received = await frame;
    // Participation volume is fine to share; the breakdown is not.
    expect(received.totalVotes).toBe(1);
    expect(received.counts).toBeNull();
  });

  it('sends the full split to a client that has voted', async () => {
    await seedActivePoll();
    const first = await makeUserToken('first@test.local', 'First');
    const second = await makeUserToken('second@test.local', 'Second');

    const firstSocket = await connect(first.token);
    await emitWithAck(firstSocket, 'poll:join', { pollId: 'poll_live' });
    await emitWithAck(firstSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    const frame = waitFor<{ counts: { optionId: string; voteCount: number }[] | null }>(
      firstSocket,
      'poll:updated',
    );

    const secondSocket = await connect(second.token);
    await emitWithAck(secondSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_2' });

    const received = await frame;
    expect(received.counts).not.toBeNull();
    expect(received.counts!.find((c) => c.optionId === 'popt_2')?.voteCount).toBe(1);
  });

  it('reveals the split to a spectator once the poll closes', async () => {
    await seedActivePoll();
    const voter = await makeUserToken('voter@test.local', 'Voter');
    const spectator = await makeUserToken('spectator@test.local', 'Spectator');
    const producer = await makeUserToken('producer@test.local', 'Producer', { role: 'PRODUCER' });

    const voterSocket = await connect(voter.token);
    const spectatorSocket = await connect(spectator.token);
    await emitWithAck(spectatorSocket, 'poll:join', { pollId: 'poll_live' });
    await emitWithAck(voterSocket, 'poll:vote', { pollId: 'poll_live', optionId: 'popt_1' });

    await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/polls/admin/poll_live/close`,
      headers: { authorization: `Bearer ${producer.token}` },
    });

    // After closing, re-joining gives the spectator the final numbers.
    const ack = await emitWithAck<{ poll: { counts: unknown } }>(spectatorSocket, 'poll:join', {
      pollId: 'poll_live',
    });
    expect(ack.poll.counts).not.toBeNull();
  });
});
