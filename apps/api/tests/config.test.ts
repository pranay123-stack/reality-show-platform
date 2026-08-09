import { afterEach, describe, expect, it } from 'vitest';

import { getConfig, resetConfigCache } from '../src/core/config.js';

const snapshot = { ...process.env };

afterEach(() => {
  process.env = { ...snapshot };
  resetConfigCache();
});

describe('configuration', () => {
  it('parses the test environment successfully', () => {
    const config = getConfig();
    expect(config.NODE_ENV).toBe('test');
    expect(config.isTest).toBe(true);
    expect(config.API_PORT).toBe(4000);
    expect(config.corsOrigins).toContain('http://localhost:3010');
  });

  it('splits a comma-separated CORS allow-list', () => {
    resetConfigCache();
    process.env.CORS_ORIGIN = 'http://a.test, http://b.test';
    expect(getConfig().corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('fails loudly when a required variable is missing', () => {
    resetConfigCache();
    delete process.env.DATABASE_URL;
    expect(() => getConfig()).toThrow(/DATABASE_URL/);
  });

  it('rejects a short signing secret', () => {
    resetConfigCache();
    process.env.JWT_ACCESS_SECRET = 'tooshort';
    expect(() => getConfig()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses to boot production with placeholder secrets', () => {
    resetConfigCache();
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'dev-access-secret-change-me-0123456789abcdef';
    expect(() => getConfig()).toThrow(/placeholder secrets/);
  });
});
