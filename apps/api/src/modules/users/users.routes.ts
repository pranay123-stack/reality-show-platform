import { idParamSchema, updateProfileSchema } from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import { authenticate, requireAuth } from '../../core/auth/guards.js';
import { parseBody, parseParams } from '../../core/validation.js';
import { getPublicProfile, updateProfile } from './users.service.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** Update the signed-in user's own profile. */
  app.patch('/me', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    const input = parseBody(request, updateProfileSchema);
    return { data: await updateProfile(auth.userId, input) };
  });

  /**
   * Public profile. Deliberately narrow: display name, avatar, bio and points.
   * Never the email address, and never anything about sessions or devices.
   */
  app.get('/:id', async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getPublicProfile(id) };
  });
}
