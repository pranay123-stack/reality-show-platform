import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Fastify, real Postgres, real Redis.
 *
 * `tests/unit/**` is deliberately excluded — it has its own project
 * (`vitest.unit.config.ts`) because those tests can run in parallel and these
 * cannot.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/app.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration suites share one Postgres database and truncate it between
    // files; run them serially so they cannot clobber each other's fixtures.
    // The advisory lock in `global-setup.ts` covers the other half of this —
    // two separate `vitest` processes racing the same database.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
