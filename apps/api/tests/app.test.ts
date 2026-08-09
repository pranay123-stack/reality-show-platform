import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('application wiring', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ minimal: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a service descriptor at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { name: 'reality-platform-api' } });
  });

  it('exposes the versioned API prefix', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.version).toBe('v1');
  });

  it('answers /health with a dependency snapshot', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    // 200 when the dev stack is up, 503 when Postgres is not running locally.
    expect([200, 503]).toContain(response.statusCode);
    const body = response.json();
    expect(body).toHaveProperty('dependencies.database');
    expect(body).toHaveProperty('dependencies.redis');
    expect(['ok', 'degraded', 'error']).toContain(body.status);
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    expect(response.json().error).toHaveProperty('requestId');
  });
});
