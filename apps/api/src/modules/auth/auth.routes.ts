import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  sessionIdParamSchema,
  signupSchema,
  verifyEmailSchema,
} from '@reality/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '../../core/auth/cookies.js';
import { authenticate, requireAuth } from '../../core/auth/guards.js';
import { unauthenticated } from '../../core/errors.js';
import { parseBody, parseParams } from '../../core/validation.js';
import * as authService from './auth.service.js';

function metaFrom(request: FastifyRequest): authService.RequestMeta {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    acceptLanguage: request.headers['accept-language'],
  };
}

function sendAuthSuccess(reply: FastifyReply, result: authService.AuthSuccess, status = 200) {
  setAuthCookies(reply, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    csrfToken: result.csrfToken,
    rememberMe: result.rememberMe,
  });

  return reply.status(status).send({
    data: {
      user: result.user,
      // Also returned in the body so non-browser clients can use bearer auth.
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      csrfToken: result.csrfToken,
    },
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Sign up. Creates the account, sends a verification email, starts a session. */
  app.post(
    '/signup',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parseBody(request, signupSchema);
      const result = await authService.signup(input, metaFrom(request));
      return sendAuthSuccess(reply, result, 201);
    },
  );

  /** Log in. Throttled per account *and* per IP. */
  app.post(
    '/login',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const input = parseBody(request, loginSchema);
      const result = await authService.login(input, metaFrom(request));
      return sendAuthSuccess(reply, result);
    },
  );

  /** Rotate the refresh token. The old one is consumed. */
  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const token = request.cookies?.[REFRESH_COOKIE];
      if (!token) throw unauthenticated('No active session');

      try {
        const result = await authService.refresh(token, metaFrom(request));
        return sendAuthSuccess(reply, result);
      } catch (error) {
        // A failed refresh should not leave stale cookies behind.
        clearAuthCookies(reply);
        throw error;
      }
    },
  );

  /** Log out of the current session only. */
  app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const auth = requireAuth(request);
    await authService.logout(auth.sessionId);
    clearAuthCookies(reply);
    return reply.send({ data: { loggedOut: true } });
  });

  /** Log out everywhere. */
  app.post('/logout-all', { preHandler: [authenticate] }, async (request, reply) => {
    const auth = requireAuth(request);
    const count = await authService.revokeAllSessions(auth.userId);
    clearAuthCookies(reply);
    return reply.send({ data: { loggedOut: true, sessionsEnded: count } });
  });

  /** The signed-in user, with role and permission list. */
  app.get('/me', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: await authService.getCurrentUser(auth.userId) };
  });

  app.post(
    '/verify-email',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { token } = parseBody(request, verifyEmailSchema);
      const user = await authService.verifyEmail(token);
      return reply.send({ data: user });
    },
  );

  app.post(
    '/resend-verification',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { email } = parseBody(request, resendVerificationSchema);
      await authService.resendVerification(email);
      // Always the same answer, whether or not the address is registered.
      return reply.send({
        data: { sent: true },
        meta: { message: 'If that address needs verification, a new link is on its way.' },
      });
    },
  );

  app.post(
    '/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parseBody(request, forgotPasswordSchema);
      await authService.forgotPassword(input, metaFrom(request));
      return reply.send({
        data: { sent: true },
        meta: { message: 'If an account exists for that address, a reset link is on its way.' },
      });
    },
  );

  app.post(
    '/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parseBody(request, resetPasswordSchema);
      await authService.resetPassword(input.token, input.password);
      clearAuthCookies(reply);
      return reply.send({ data: { reset: true } });
    },
  );

  app.post(
    '/change-password',
    { preHandler: [authenticate], config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, changePasswordSchema);
      await authService.changePassword(
        auth.userId,
        auth.sessionId,
        input.currentPassword,
        input.newPassword,
      );
      return reply.send({ data: { changed: true } });
    },
  );

  /** Active sessions for the signed-in user, with the current one marked. */
  app.get('/sessions', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: await authService.listSessions(auth.userId, auth.sessionId) };
  });

  app.delete('/sessions/:sessionId', { preHandler: [authenticate] }, async (request, reply) => {
    const auth = requireAuth(request);
    const { sessionId } = parseParams(request, sessionIdParamSchema);
    await authService.revokeSession(auth.userId, sessionId);
    if (sessionId === auth.sessionId) clearAuthCookies(reply);
    return reply.send({ data: { revoked: true } });
  });
}
