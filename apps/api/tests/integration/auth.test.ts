import { API_PREFIX } from '@reality/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../../src/core/auth/cookies.js';
import { setMailer, type MailMessage } from '../../src/core/mailer.js';
import { hashPassword } from '../../src/core/password.js';
import { TestClient, VALID_PASSWORD, buildTestApp } from '../helpers/app.js';
import { disconnectTestDatabase, resetAll, testPrisma as db } from '../helpers/db.js';

const AUTH = `${API_PREFIX}/auth`;

let app: FastifyInstance;
const outbox: MailMessage[] = [];

beforeAll(async () => {
  setMailer({
    async send(message) {
      outbox.push(message);
    },
  });
  app = await buildTestApp();
});

afterAll(async () => {
  setMailer(null);
  await app.close();
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await resetAll();
  outbox.length = 0;
});

function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'newviewer@example.com',
    password: VALID_PASSWORD,
    displayName: 'NewViewer',
    acceptedTerms: true,
    ...overrides,
  };
}

async function signup(client: TestClient, overrides: Record<string, unknown> = {}) {
  return client.request({ method: 'POST', url: `${AUTH}/signup`, payload: signupBody(overrides) });
}

function tokenFromLink(text: string): string {
  const match = /token=([^\s&]+)/.exec(text);
  if (!match) throw new Error(`No token found in email:\n${text}`);
  return decodeURIComponent(match[1]!);
}

// ---------------------------------------------------------------------------

describe('signup', () => {
  it('creates an account, sets auth cookies and sends a verification email', async () => {
    const client = new TestClient(app);
    const response = await signup(client);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.user.email).toBe('newviewer@example.com');
    expect(body.data.user.role).toBe('USER');
    expect(body.data.user.status).toBe('PENDING_VERIFICATION');
    expect(body.data.user.emailVerified).toBe(false);
    expect(body.data.accessToken).toBeTruthy();

    expect(client.getCookie(ACCESS_COOKIE)).toBeTruthy();
    expect(client.getCookie(REFRESH_COOKIE)).toBeTruthy();
    expect(client.getCookie(CSRF_COOKIE)).toBeTruthy();

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.subject).toMatch(/confirm/i);
  });

  it('never returns the password or its hash', async () => {
    const client = new TestClient(app);
    const response = await signup(client);
    const raw = response.body;
    expect(raw).not.toContain(VALID_PASSWORD);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('scrypt$');
  });

  it('rejects a duplicate email address', async () => {
    await signup(new TestClient(app));
    const response = await signup(new TestClient(app), { displayName: 'DifferentName' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a duplicate display name', async () => {
    await signup(new TestClient(app));
    const response = await signup(new TestClient(app), { email: 'other@example.com' });
    expect(response.statusCode).toBe(409);
  });

  it('blocks a second account created with a provider alias of the same mailbox', async () => {
    await signup(new TestClient(app), { email: 'fan@gmail.com', displayName: 'FanOne' });

    const aliased = await signup(new TestClient(app), {
      email: 'f.a.n+second@gmail.com',
      displayName: 'FanTwo',
    });

    expect(aliased.statusCode).toBe(409);
    expect(aliased.json().error.code).toBe('EMAIL_TAKEN');
    expect(await db.user.count()).toBe(1);
  });

  it('rejects a weak password with a field-level message', async () => {
    const response = await signup(new TestClient(app), { password: 'short' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details.fieldErrors.password).toBeTruthy();
  });

  it('requires explicit acceptance of the terms', async () => {
    const response = await signup(new TestClient(app), { acceptedTerms: false });
    expect(response.statusCode).toBe(400);
  });

  it('records a device for the new account', async () => {
    const client = new TestClient(app);
    await client.request({
      method: 'POST',
      url: `${AUTH}/signup`,
      payload: signupBody(),
      headers: { 'user-agent': 'TestBrowser/1.0', 'accept-language': 'en-GB' },
    });

    expect(await db.userDevice.count()).toBe(1);
  });
});

describe('duplicate-account signals', () => {
  it('raises an advisory signal when one device creates several accounts — without blocking', async () => {
    const headers = { 'user-agent': 'SharedBrowser/2.0', 'accept-language': 'en' };
    const first = new TestClient(app);
    const second = new TestClient(app);

    await first.request({
      method: 'POST',
      url: `${AUTH}/signup`,
      payload: signupBody(),
      headers,
    });
    const response = await second.request({
      method: 'POST',
      url: `${AUTH}/signup`,
      payload: signupBody({ email: 'second@example.com', displayName: 'SecondViewer' }),
      headers,
    });

    // The second signup succeeds: a shared device is not proof of anything.
    expect(response.statusCode).toBe(201);

    const signals = await db.duplicateSignal.findMany();
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0]!.type).toBe('DEVICE_REUSE');
    expect(signals[0]!.reviewedAt).toBeNull();

    // Nobody was auto-banned.
    const users = await db.user.findMany({ select: { status: true } });
    expect(users.every((user) => user.status !== 'BANNED')).toBe(true);
  });
});

describe('email verification', () => {
  it('verifies the address and activates the account', async () => {
    const client = new TestClient(app);
    await signup(client);
    const token = tokenFromLink(outbox[0]!.text);

    const response = await client.request({
      method: 'POST',
      url: `${AUTH}/verify-email`,
      payload: { token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.emailVerified).toBe(true);
    expect(response.json().data.status).toBe('ACTIVE');
  });

  it('refuses a reused verification token', async () => {
    const client = new TestClient(app);
    await signup(client);
    const token = tokenFromLink(outbox[0]!.text);

    await client.request({ method: 'POST', url: `${AUTH}/verify-email`, payload: { token } });
    const second = await client.request({
      method: 'POST',
      url: `${AUTH}/verify-email`,
      payload: { token },
    });

    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe('TOKEN_INVALID');
  });

  it('refuses a forged token', async () => {
    const client = new TestClient(app);
    await signup(client);
    const response = await client.request({
      method: 'POST',
      url: `${AUTH}/verify-email`,
      payload: { token: 'x'.repeat(43) },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await signup(new TestClient(app));
  });

  it('signs in with the right credentials', async () => {
    const client = new TestClient(app);
    const response = await client.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.displayName).toBe('NewViewer');
    expect(client.getCookie(ACCESS_COOKIE)).toBeTruthy();
  });

  it('is case-insensitive about the email address', async () => {
    const response = await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'NewViewer@Example.com', password: VALID_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a wrong password with a generic message', async () => {
    const response = await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: 'definitely-wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(response.json().error.message).toBe('Email or password is incorrect');
  });

  it('gives the identical answer for an unknown account, so addresses cannot be enumerated', async () => {
    const unknown = await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'nobody@example.com', password: 'definitely-wrong-password' },
    });
    const wrongPassword = await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: 'definitely-wrong-password' },
    });

    expect(unknown.statusCode).toBe(wrongPassword.statusCode);
    expect(unknown.json().error.code).toBe(wrongPassword.json().error.code);
    expect(unknown.json().error.message).toBe(wrongPassword.json().error.message);
  });

  it('locks the account out after repeated failures, then reports the wait', async () => {
    const attempt = () =>
      new TestClient(app).request({
        method: 'POST',
        url: `${AUTH}/login`,
        payload: { email: 'newviewer@example.com', password: 'wrong-password-here' },
      });

    for (let i = 0; i < 5; i += 1) await attempt();

    const locked = await attempt();
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('RATE_LIMITED');

    // Even the correct password is refused while the lock-out is in force.
    const correct = await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });
    expect(correct.statusCode).toBe(429);
  });

  it('refuses a suspended account with a distinct code', async () => {
    await db.user.updateMany({
      where: { email: 'newviewer@example.com' },
      data: { status: 'SUSPENDED' },
    });

    const response = await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('protected routes', () => {
  it('rejects an anonymous request with 401', async () => {
    const response = await app.inject({ method: 'GET', url: `${AUTH}/me` });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${AUTH}/me`,
      headers: { authorization: 'Bearer not.a.real.token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('TOKEN_INVALID');
  });

  it('allows a signed-in user and returns their permissions', async () => {
    const client = new TestClient(app);
    await signup(client);

    const response = await client.request({ method: 'GET', url: `${AUTH}/me` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.email).toBe('newviewer@example.com');
    expect(response.json().data.permissions).toEqual([]);
  });

  it('rejects a cookie-authenticated write without the CSRF header', async () => {
    const client = new TestClient(app);
    await signup(client);

    const response = await app.inject({
      method: 'POST',
      url: `${AUTH}/logout`,
      headers: { cookie: client.cookieHeader }, // cookies, but no X-CSRF-Token
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/CSRF/i);
  });

  it('rejects a mismatched CSRF token', async () => {
    const client = new TestClient(app);
    await signup(client);

    const response = await app.inject({
      method: 'POST',
      url: `${AUTH}/logout`,
      headers: { cookie: client.cookieHeader, 'x-csrf-token': 'f'.repeat(64) },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('logout', () => {
  it('ends the session and clears the cookies', async () => {
    const client = new TestClient(app);
    await signup(client);

    const loggedOut = await client.request({ method: 'POST', url: `${AUTH}/logout` });
    expect(loggedOut.statusCode).toBe(200);

    const after = await client.request({ method: 'GET', url: `${AUTH}/me` });
    expect(after.statusCode).toBe(401);
  });

  it('invalidates the access token immediately, not just the cookie', async () => {
    const client = new TestClient(app);
    const signupResponse = await signup(client);
    const accessToken = signupResponse.json().data.accessToken;

    await client.request({ method: 'POST', url: `${AUTH}/logout` });

    const stolen = await app.inject({
      method: 'GET',
      url: `${AUTH}/me`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(stolen.statusCode).toBe(401);
    expect(stolen.json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('refresh', () => {
  it('rotates the refresh token', async () => {
    const client = new TestClient(app);
    await signup(client);
    const original = client.getCookie(REFRESH_COOKIE);

    const response = await client.request({ method: 'POST', url: `${AUTH}/refresh` });
    expect(response.statusCode).toBe(200);
    expect(client.getCookie(REFRESH_COOKIE)).not.toBe(original);
  });

  it('treats a replayed refresh token as theft and kills every session', async () => {
    const client = new TestClient(app);
    await signup(client);
    const stolen = client.getCookie(REFRESH_COOKIE)!;

    await client.request({ method: 'POST', url: `${AUTH}/refresh` });

    const replay = await app.inject({
      method: 'POST',
      url: `${AUTH}/refresh`,
      headers: { cookie: `${REFRESH_COOKIE}=${stolen}` },
    });
    expect(replay.statusCode).toBe(401);

    // The legitimate holder is signed out too — the safe response to a leak.
    const after = await client.request({ method: 'GET', url: `${AUTH}/me` });
    expect(after.statusCode).toBe(401);
  });
});

describe('password reset', () => {
  beforeEach(async () => {
    await signup(new TestClient(app));
    outbox.length = 0;
  });

  it('answers identically for a known and an unknown address', async () => {
    const known = await app.inject({
      method: 'POST',
      url: `${AUTH}/forgot-password`,
      payload: { email: 'newviewer@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: `${AUTH}/forgot-password`,
      payload: { email: 'nobody@example.com' },
    });

    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.body).toBe(unknown.body);
  });

  it('resets the password, burns the token and ends every session', async () => {
    const activeClient = new TestClient(app);
    await activeClient.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });

    await app.inject({
      method: 'POST',
      url: `${AUTH}/forgot-password`,
      payload: { email: 'newviewer@example.com' },
    });

    const token = tokenFromLink(outbox[0]!.text);
    const newPassword = 'a-brand-new-password-1';

    const reset = await app.inject({
      method: 'POST',
      url: `${AUTH}/reset-password`,
      payload: { token, password: newPassword, confirmPassword: newPassword },
    });
    expect(reset.statusCode).toBe(200);

    // Existing sessions are gone.
    expect((await activeClient.request({ method: 'GET', url: `${AUTH}/me` })).statusCode).toBe(401);

    // The old password no longer works, the new one does.
    const oldPassword = await app.inject({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });
    expect(oldPassword.statusCode).toBe(401);

    const withNew = await app.inject({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: newPassword },
    });
    expect(withNew.statusCode).toBe(200);

    // The reset token cannot be reused.
    const replay = await app.inject({
      method: 'POST',
      url: `${AUTH}/reset-password`,
      payload: { token, password: newPassword, confirmPassword: newPassword },
    });
    expect(replay.statusCode).toBe(400);
  });
});

describe('sessions', () => {
  it('lists active sessions and marks the current one', async () => {
    const client = new TestClient(app);
    await signup(client);
    await new TestClient(app).request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });

    const response = await client.request({ method: 'GET', url: `${AUTH}/sessions` });
    const sessions = response.json().data;

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session: { current: boolean }) => session.current)).toHaveLength(1);
  });

  it('lets a user end another session, and refuses to touch someone else’s', async () => {
    const owner = new TestClient(app);
    await signup(owner);

    const other = new TestClient(app);
    await other.request({
      method: 'POST',
      url: `${AUTH}/login`,
      payload: { email: 'newviewer@example.com', password: VALID_PASSWORD },
    });

    const sessions = (await owner.request({ method: 'GET', url: `${AUTH}/sessions` })).json().data;
    const otherSession = sessions.find((session: { current: boolean }) => !session.current);

    const revoked = await owner.request({
      method: 'DELETE',
      url: `${AUTH}/sessions/${otherSession.id}`,
    });
    expect(revoked.statusCode).toBe(200);
    expect((await other.request({ method: 'GET', url: `${AUTH}/me` })).statusCode).toBe(401);

    // A stranger's session id is simply "not found".
    const stranger = new TestClient(app);
    await signup(stranger, { email: 'stranger@example.com', displayName: 'Stranger' });
    const attack = await stranger.request({
      method: 'DELETE',
      url: `${AUTH}/sessions/${sessions[0].id}`,
    });
    expect(attack.statusCode).toBe(404);
  });
});

describe('role protection', () => {
  async function createUserWithRole(role: 'USER' | 'MODERATOR' | 'PRODUCER' | 'ADMIN') {
    const email = `${role.toLowerCase()}@example.com`;
    await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: await hashPassword(VALID_PASSWORD),
        role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: `${role}User` } },
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

  it('gives each role exactly the permissions it should have', async () => {
    const expectations = [
      { role: 'USER' as const, has: [], lacks: ['challenge.moderate', 'poll.create', 'user.manage'] },
      {
        role: 'MODERATOR' as const,
        has: ['challenge.moderate'],
        lacks: ['poll.create', 'user.manage'],
      },
      {
        role: 'PRODUCER' as const,
        has: ['challenge.moderate', 'poll.create', 'official.publish'],
        lacks: ['user.manage', 'points.reverse'],
      },
      {
        role: 'ADMIN' as const,
        has: ['challenge.moderate', 'poll.create', 'user.manage', 'points.reverse'],
        lacks: [],
      },
    ];

    for (const expectation of expectations) {
      const client = await createUserWithRole(expectation.role);
      const permissions = (await client.request({ method: 'GET', url: `${AUTH}/me` })).json().data
        .permissions as string[];

      for (const permission of expectation.has) {
        expect(permissions, `${expectation.role} should have ${permission}`).toContain(permission);
      }
      for (const permission of expectation.lacks) {
        expect(permissions, `${expectation.role} should not have ${permission}`).not.toContain(
          permission,
        );
      }
    }
  });

  it('invalidates a token minted before a role change', async () => {
    const client = await createUserWithRole('USER');
    expect((await client.request({ method: 'GET', url: `${AUTH}/me` })).statusCode).toBe(200);

    await db.user.updateMany({ where: { email: 'user@example.com' }, data: { role: 'ADMIN' } });
    // Clear the cached session snapshot the way a role change does in production.
    const sessions = await db.userSession.findMany({ select: { id: true } });
    const { invalidateSessionCache } = await import('../../src/core/auth/session-cache.js');
    await Promise.all(sessions.map((session) => invalidateSessionCache(session.id)));

    const response = await client.request({ method: 'GET', url: `${AUTH}/me` });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('profile', () => {
  it('updates the signed-in user’s own profile', async () => {
    const client = new TestClient(app);
    await signup(client);

    const response = await client.request({
      method: 'PATCH',
      url: `${API_PREFIX}/users/me`,
      payload: { bio: 'Watches every episode twice.', country: 'IN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.bio).toBe('Watches every episode twice.');
  });

  it('never exposes an email address on a public profile', async () => {
    const client = new TestClient(app);
    const created = await signup(client);
    const userId = created.json().data.user.id;

    const response = await app.inject({ method: 'GET', url: `${API_PREFIX}/users/${userId}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('newviewer@example.com');
    expect(response.json().data.displayName).toBe('NewViewer');
  });
});
