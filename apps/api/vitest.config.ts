import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration suites share one Postgres database; run files serially so they
    // cannot clobber each other's fixtures.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
