import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError, forbidden, notFound, registerErrorHandler } from '../src/core/errors.js';
import { parseBody } from '../src/core/validation.js';

async function appThatThrows(thrown: unknown) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.post('/boom', async (request) => {
    if (thrown === 'validate') {
      return parseBody(request, z.object({ name: z.string().min(3) }));
    }
    throw thrown;
  });
  await app.ready();
  return app;
}

describe('error handling', () => {
  it('maps AppError to its status code and machine-readable code', async () => {
    const app = await appThatThrows(notFound('Contestant not found'));
    const response = await app.inject({ method: 'POST', url: '/boom' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Contestant not found',
    });
    await app.close();
  });

  it('maps forbidden to 403', async () => {
    const app = await appThatThrows(forbidden());
    const response = await app.inject({ method: 'POST', url: '/boom' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('never leaks internal detail on a 500', async () => {
    const app = await appThatThrows(new Error('connection string postgres://user:hunter2@db'));
    const response = await app.inject({ method: 'POST', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Something went wrong on our side');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    await app.close();
  });

  it('hides the message of a non-exposed AppError', async () => {
    const app = await appThatThrows(
      new AppError({ code: 'INTERNAL_ERROR', message: 'secret internal detail', statusCode: 500 }),
    );
    const response = await app.inject({ method: 'POST', url: '/boom' });
    expect(response.json().error.message).not.toContain('secret internal detail');
    await app.close();
  });

  it('returns field-level detail for validation failures', async () => {
    const app = await appThatThrows('validate');
    const response = await app.inject({ method: 'POST', url: '/boom', payload: { name: 'ab' } });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.fieldErrors.name).toBeTruthy();
    await app.close();
  });
});
