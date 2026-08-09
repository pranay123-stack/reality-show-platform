import { describe, expect, it } from 'vitest';

import { PAGINATION } from '../constants';
import { ROLE_RANK, roleAtLeast } from '../enums';
import { cursorPaginationSchema, healthResponseSchema } from '../schemas/common';

describe('role ordering', () => {
  it('ranks roles by capability', () => {
    expect(ROLE_RANK.USER).toBeLessThan(ROLE_RANK.MODERATOR);
    expect(ROLE_RANK.MODERATOR).toBeLessThan(ROLE_RANK.PRODUCER);
    expect(ROLE_RANK.PRODUCER).toBeLessThan(ROLE_RANK.ADMIN);
  });

  it('grants a higher role every lower-role capability', () => {
    expect(roleAtLeast('ADMIN', 'MODERATOR')).toBe(true);
    expect(roleAtLeast('PRODUCER', 'PRODUCER')).toBe(true);
    expect(roleAtLeast('USER', 'MODERATOR')).toBe(false);
    expect(roleAtLeast('MODERATOR', 'PRODUCER')).toBe(false);
  });
});

describe('cursorPaginationSchema', () => {
  it('applies the default limit', () => {
    expect(cursorPaginationSchema.parse({})).toEqual({ limit: PAGINATION.DEFAULT_LIMIT });
  });

  it('coerces numeric strings from query params', () => {
    expect(cursorPaginationSchema.parse({ limit: '5' }).limit).toBe(5);
  });

  it('rejects a limit above the hard maximum', () => {
    expect(cursorPaginationSchema.safeParse({ limit: PAGINATION.MAX_LIMIT + 1 }).success).toBe(
      false,
    );
  });
});

describe('healthResponseSchema', () => {
  it('accepts a well-formed health payload', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      uptimeSeconds: 1.23,
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      dependencies: { database: 'up', redis: 'up' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown dependency state', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      uptimeSeconds: 1,
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      dependencies: { database: 'maybe', redis: 'up' },
    });
    expect(parsed.success).toBe(false);
  });
});
