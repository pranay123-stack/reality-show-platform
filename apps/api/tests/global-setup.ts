import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export default async function setup(): Promise<void> {
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
}
