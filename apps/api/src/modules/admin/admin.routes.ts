import { auditQuerySchema } from '@reality/shared';
import type { FastifyInstance } from 'fastify';

import { authenticate, requireAuth, requirePermission, requireRole } from '../../core/auth/guards.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { parseQuery } from '../../core/validation.js';
import { auditFacets, getOverview, listAudit, sectionsForRole } from './admin.service.js';

/**
 * The console's own endpoints.
 *
 * Read-only by design. Every mutation the dashboard performs goes to the module
 * that owns it, which is where its permission check and its audit row already
 * live — adding a second write path here would mean two places to keep in step
 * and two places to get wrong.
 *
 * There is deliberately no audit row written for reading this data: an audit
 * trail that records its own being read fills with noise and buries the actions
 * that matter.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The gate for the console as a whole.
   *
   * MODERATOR is the floor because a moderator has a genuine queue to work;
   * an ordinary USER has nothing here and is refused outright.
   */
  app.get(
    '/overview',
    { preHandler: [authenticate, requireRole('MODERATOR')] },
    async (request) => {
      const auth = requireAuth(request);
      return { data: await getOverview(auth.role) };
    },
  );

  /** What the caller may open. The sidebar renders from this. */
  app.get('/sections', { preHandler: [authenticate, requireRole('MODERATOR')] }, async (request) => {
    const auth = requireAuth(request);
    return { data: { sections: sectionsForRole(auth.role), role: auth.role } };
  });

  // --- audit trail ---------------------------------------------------------

  app.get(
    '/audit',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.AUDIT_VIEW)] },
    async (request) => {
      const query = parseQuery(request, auditQuerySchema);
      return { data: await listAudit(query) };
    },
  );

  app.get(
    '/audit/facets',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.AUDIT_VIEW)] },
    async () => ({ data: await auditFacets() }),
  );
}
