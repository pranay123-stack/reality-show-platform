import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

/**
 * Vitest global setup.
 *
 * Integration tests run against a dedicated `reality_test` database so they can
 * truncate freely without touching the seeded development data. Prisma creates
 * the database if it does not exist, then applies every migration.
 *
 * Requires `pnpm dev:infra` (or any reachable PostgreSQL) — the failure message
 * says so explicitly rather than letting dozens of tests fail obscurely.
 */
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://reality:reality@localhost:5442/reality_test?schema=public';

/**
 * An arbitrary but fixed key. Postgres advisory locks live in a single global
 * namespace, so the number only has to be stable and unlikely to collide.
 */
const SUITE_LOCK_KEY = 8_120_251;

let lockClient: PrismaClient | null = null;

/**
 * Claims the integration suite lock, or explains why it could not.
 *
 * Two `vitest` processes against one database do not fail loudly — they fail
 * *confusingly*, because each truncates tables the other is mid-way through
 * using. That produced 63 phantom failures during Phase 19 which a single clean
 * run did not reproduce, and cost an afternoon. A session-scoped advisory lock
 * turns that into an immediate, legible error.
 */
async function claimSuiteLock(): Promise<void> {
  lockClient = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
    log: ['error'],
  });

  const rows = await lockClient.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_lock(${SUITE_LOCK_KEY}) AS locked`;

  if (!rows[0]?.locked) {
    await lockClient.$disconnect();
    lockClient = null;
    throw new Error(
      [
        'Another integration test run is already using this database.',
        `URL: ${TEST_DATABASE_URL}`,
        '',
        'Two runs against one database truncate each other mid-test and produce',
        'failures that do not reproduce. Wait for the other run to finish, or',
        'point this one somewhere else:',
        '',
        '  TEST_DATABASE_URL=postgresql://reality:reality@localhost:5442/reality_test_2 pnpm test:integration',
      ].join('\n'),
    );
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        'Could not prepare the integration test database.',
        `URL: ${TEST_DATABASE_URL}`,
        'Start the development infrastructure first:  pnpm dev:infra',
        '',
        detail,
      ].join('\n'),
    );
  }

  await claimSuiteLock();

  // Released explicitly rather than relying on the connection dropping, so a
  // crashed run does not leave the next one waiting on a ghost.
  return async () => {
    if (!lockClient) return;
    await lockClient.$queryRaw`SELECT pg_advisory_unlock(${SUITE_LOCK_KEY})`;
    await lockClient.$disconnect();
    lockClient = null;
  };
}
