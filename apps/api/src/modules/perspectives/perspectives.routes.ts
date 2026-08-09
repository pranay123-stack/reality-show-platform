import {
  createPerspectiveSchema,
  idParamSchema,
  listPerspectivesQuerySchema,
  submitPerspectiveVoteSchema,
} from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import {
  authenticate,
  optionalAuthenticate,
  requireAuth,
  requirePermission,
  requireVerifiedEmail,
} from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseBody, parseParams, parseQuery } from '../../core/validation.js';
import { writeAudit } from '../audit/audit.service.js';
import {
  closePerspective,
  createPerspective,
  getPerspective,
  getPerspectiveAnalytics,
  listPerspectives,
  openPerspective,
  votePerspective,
} from './perspectives.service.js';

export async function perspectiveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, listPerspectivesQuerySchema);
    return { data: await listPerspectives(request.auth?.userId ?? null, query) };
  });

  /**
   * Registered before `/:id` so "analytics" is never parsed as an id.
   * Public: the whole point of the feature is a shared read on what the
   * audience thought.
   */
  app.get('/analytics', async () => ({ data: await getPerspectiveAnalytics() }));

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getPerspective(id, request.auth?.userId ?? null) };
  });

  app.post(
    '/:id/vote',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const { optionId } = parseBody(request, submitPerspectiveVoteSchema);
      return { data: await votePerspective(id, auth.userId, optionId) };
    },
  );

  // --- operator ------------------------------------------------------------

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PERSPECTIVE_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createPerspectiveSchema);
      const perspective = await createPerspective(input, auth.userId);
      await writeAudit(request, 'perspective.create', 'AudiencePerspective', perspective.id, {
        after: input,
      });
      return reply.status(201).send({ data: perspective });
    },
  );

  app.post(
    '/admin/:id/open',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PERSPECTIVE_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const perspective = await openPerspective(id);
      await writeAudit(request, 'perspective.open', 'AudiencePerspective', id);
      return { data: perspective };
    },
  );

  app.post(
    '/admin/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PERSPECTIVE_MANAGE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const perspective = await closePerspective(id);
      await writeAudit(request, 'perspective.close', 'AudiencePerspective', id);
      return { data: perspective };
    },
  );
}
