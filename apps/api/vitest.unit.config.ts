import { defineConfig } from 'vitest/config';

/**
 * Unit tests: pure functions, no database, no Redis, no server.
 *
 * Kept in a separate project from the integration suite for one reason — these
 * can run in parallel and the integration tests cannot, because they share one
 * database and truncate it between files. Mixing them means the whole suite
 * runs at the speed of the slowest constraint.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // No shared mutable state, so let them run wide.
    pool: 'threads',
  },
});
