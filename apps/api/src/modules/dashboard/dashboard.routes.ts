import type { FastifyInstance } from 'fastify';

import { authenticate, requireAuth } from '../../core/auth/guards.js';
import { getDashboard } from './dashboard.service.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const auth = requireAuth(request);
    return { data: await getDashboard(auth.userId) };
  });
}
