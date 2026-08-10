import {
  createPredictionSchema,
  idParamSchema,
  listPredictionsQuerySchema,
  resolvePredictionSchema,
  submitPredictionSchema,
  updatePredictionSchema,
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
  activatePrediction,
  cancelPrediction,
  closePrediction,
  createPrediction,
  getPrediction,
  listPredictions,
  listPredictionsForAdmin,
  resolvePrediction,
  submitPrediction,
  updatePrediction,
} from './predictions.service.js';

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Operator list. Registered before `/:id` so `/admin` is never read as an id.
   *
   * Carries the per-option distribution the public list withholds — see
   * `listPredictionsForAdmin` for why that is safe here and not there.
   */
  app.get(
    '/admin/list',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_CREATE)] },
    async () => ({ data: await listPredictionsForAdmin() }),
  );

  /** Browsing is open; the payload just omits "your entry" for anonymous callers. */
  app.get('/', { preHandler: [optionalAuthenticate] }, async (request) => {
    const query = parseQuery(request, listPredictionsQuerySchema);
    return { data: await listPredictions(request.auth?.userId ?? null, query) };
  });

  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request) => {
    const { id } = parseParams(request, idParamSchema);
    return { data: await getPrediction(id, request.auth?.userId ?? null) };
  });

  /** Taking part needs a confirmed email — one of the anti-duplicate layers. */
  app.post(
    '/:id/entries',
    {
      preHandler: [authenticate, requireVerifiedEmail],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, submitPredictionSchema);
      return { data: await submitPrediction(id, auth.userId, input) };
    },
  );

  // --- operator lifecycle --------------------------------------------------

  app.post(
    '/admin',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_CREATE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(request, createPredictionSchema);
      const prediction = await createPrediction(input, auth.userId);
      await writeAudit(request, 'prediction.create', 'Prediction', prediction.id, { after: input });
      return reply.status(201).send({ data: prediction });
    },
  );

  app.patch(
    '/admin/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_CREATE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, updatePredictionSchema);
      const prediction = await updatePrediction(id, input);
      await writeAudit(request, 'prediction.update', 'Prediction', id, { after: input });
      return { data: prediction };
    },
  );

  app.post(
    '/admin/:id/activate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_ACTIVATE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const prediction = await activatePrediction(id);
      await writeAudit(request, 'prediction.activate', 'Prediction', id);
      return { data: prediction };
    },
  );

  app.post(
    '/admin/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_CLOSE)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const prediction = await closePrediction(id);
      await writeAudit(request, 'prediction.close', 'Prediction', id);
      return { data: prediction };
    },
  );

  app.post(
    '/admin/:id/resolve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_RESOLVE)] },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = parseParams(request, idParamSchema);
      const input = parseBody(request, resolvePredictionSchema);
      const result = await resolvePrediction(id, input.correctOptionId, auth.userId, input.notes);
      await writeAudit(request, 'prediction.resolve', 'Prediction', id, { after: result });
      return { data: result };
    },
  );

  app.post(
    '/admin/:id/cancel',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PREDICTION_CANCEL)] },
    async (request) => {
      const { id } = parseParams(request, idParamSchema);
      const prediction = await cancelPrediction(id);
      await writeAudit(request, 'prediction.cancel', 'Prediction', id);
      return { data: prediction };
    },
  );
}
