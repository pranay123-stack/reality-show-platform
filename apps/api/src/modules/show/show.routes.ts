import type { FastifyInstance } from 'fastify';

import { getCurrentShowId, getLiveState, listEpisodes, listRecentEvents } from './show.service.js';

/** Public read-only show state. No authentication: the landing page uses it too. */
export async function showRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live', async () => ({ data: await getLiveState() }));

  app.get('/episodes', async () => {
    const showId = await getCurrentShowId();
    return { data: await listEpisodes(showId) };
  });

  app.get('/events', async () => {
    const showId = await getCurrentShowId();
    return { data: await listRecentEvents(showId) };
  });
}
