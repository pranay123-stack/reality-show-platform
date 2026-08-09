/**
 * Vitest setup: guarantees a valid configuration before any module reads it.
 *
 * Values already present in the environment win, so CI can point the suite at a
 * real database while a bare `pnpm test` still boots with sane defaults.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL ??= 'postgresql://reality:reality@localhost:5442/reality_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6389/1';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef';
process.env.COOKIE_SECRET ??= 'test-cookie-secret-0123456789abcdef';
process.env.CORS_ORIGIN ??= 'http://localhost:3010';
