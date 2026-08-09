import { describe, expect, it } from 'vitest';

import { getHealth, statusToHttpCode } from '../health.service.js';

const up = async () => true;
const down = async () => false;

describe('getHealth', () => {
  it('reports ok when every dependency responds', async () => {
    const health = await getHealth({ checkDatabase: up, checkRedis: up });
    expect(health.status).toBe('ok');
    expect(health.dependencies).toEqual({ database: 'up', redis: 'up' });
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(() => new Date(health.timestamp).toISOString()).not.toThrow();
  });

  it('degrades — not fails — when only Redis is down', async () => {
    const health = await getHealth({ checkDatabase: up, checkRedis: down });
    expect(health.status).toBe('degraded');
    expect(statusToHttpCode(health.status)).toBe(200);
  });

  it('errors when the database is unreachable', async () => {
    const health = await getHealth({ checkDatabase: down, checkRedis: up });
    expect(health.status).toBe('error');
    expect(statusToHttpCode(health.status)).toBe(503);
  });
});
