import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPrisma as db } from '../helpers/db.js';

/**
 * The database as a deliverable.
 *
 * Everything else in this suite runs against a database that already exists.
 * These tests ask the questions that only matter on the day someone deploys
 * this for the first time, or restores it: does a migration chain applied to an
 * *empty* database produce the schema the code expects, does the seed run twice
 * without complaint, and are the invariants actually enforced by the database
 * rather than only by the service that happens to write to it?
 *
 * A constraint that lives only in TypeScript is a convention. One that lives in
 * Postgres is a guarantee, and the difference shows up the first time a script,
 * a migration or a second service writes to the same table.
 */

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A throwaway database, created and dropped by these tests alone.
 *
 * Deliberately not the shared `reality_test` database: proving that migrations
 * apply to an empty database means starting from one, and dropping the suite's
 * own database mid-run would be an unhelpful way to find that out.
 */
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgresql://reality:reality@localhost:5442/postgres?schema=public';
const FRESH_DB = 'reality_migration_probe';
const FRESH_URL = ADMIN_URL.replace('/postgres?', `/${FRESH_DB}?`);

/**
 * A second throwaway database purely for `migrate diff`.
 *
 * Prisma *resets* whatever it is handed as a shadow database in order to replay
 * the migration chain into it. Pointing that at the database under test wipes
 * the very thing the next test is about to inspect.
 */
const SHADOW_DB = 'reality_migration_shadow';
const SHADOW_URL = ADMIN_URL.replace('/postgres?', `/${SHADOW_DB}?`);

let admin: PrismaClient;
let fresh: PrismaClient | null = null;

async function recreate(name: string): Promise<void> {
  // `DROP DATABASE` fails while anything is connected, so terminate first.
  await admin.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
  );
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
}

async function drop(name: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
  );
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
}

beforeAll(async () => {
  admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } }, log: ['error'] });
  await recreate(FRESH_DB);
  await recreate(SHADOW_DB);
}, 60_000);

afterAll(async () => {
  await fresh?.$disconnect();
  await drop(FRESH_DB);
  await drop(SHADOW_DB);
  await admin.$disconnect();
}, 60_000);

// ---------------------------------------------------------------------------

describe('migrating an empty database', () => {
  it('applies every migration in order', () => {
    const output = execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: FRESH_URL },
      encoding: 'utf8',
    });

    // Prisma's wording differs between "applied" and "already in sync"; what
    // matters is that it did not fail and reported no error.
    expect(output).not.toMatch(/error/i);
    expect(output).toMatch(/migration/i);
  }, 120_000);

  it('records every migration as applied, with none failed', async () => {
    fresh = new PrismaClient({ datasources: { db: { url: FRESH_URL } }, log: ['error'] });

    const rows = await fresh.$queryRawUnsafe<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at');

    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const row of rows) {
      expect(row.finished_at, `${row.migration_name} did not finish`).not.toBeNull();
      expect(row.rolled_back_at, `${row.migration_name} was rolled back`).toBeNull();
    }
  });

  it('leaves no drift between the migrations and the schema', () => {
    // `migrate diff` comparing the migration chain against the live database
    // must find nothing. Drift here means a migration was hand-edited, or a
    // schema change shipped without one.
    const diff = execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-migrations',
        './prisma/migrations',
        '--to-url',
        FRESH_URL,
        '--shadow-database-url',
        SHADOW_URL,
        '--exit-code',
      ],
      { cwd: apiRoot, env: { ...process.env }, encoding: 'utf8' },
    );

    expect(diff).toMatch(/No difference detected/i);
  }, 120_000);

  it('is idempotent — deploying again changes nothing', () => {
    const output = execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: FRESH_URL },
      encoding: 'utf8',
    });

    expect(output).toMatch(/No pending migrations|already in sync/i);
  }, 120_000);
});

describe('seeding', () => {
  it('runs against a freshly migrated database', () => {
    const output = execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: FRESH_URL },
      encoding: 'utf8',
    });

    expect(output).toMatch(/seed|demo|complete/i);
  }, 120_000);

  it('runs a second time without duplicating anything', async () => {
    const client = fresh!;
    const before = {
      users: await client.user.count(),
      contestants: await client.contestant.count(),
      rewards: await client.rewardCatalog.count(),
      rules: await client.pointsRule.count(),
    };

    execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: FRESH_URL },
      encoding: 'utf8',
    });

    // Idempotent means re-runnable on a live database without a second set of
    // demo contestants appearing, which is what makes it safe in a deploy step.
    expect({
      users: await client.user.count(),
      contestants: await client.contestant.count(),
      rewards: await client.rewardCatalog.count(),
      rules: await client.pointsRule.count(),
    }).toEqual(before);
  }, 120_000);

  it('produces a usable demo world rather than empty tables', async () => {
    const client = fresh!;

    expect(await client.show.count()).toBeGreaterThan(0);
    expect(await client.contestant.count()).toBeGreaterThan(0);
    expect(await client.pointsRule.count()).toBeGreaterThan(0);
    // The demo accounts the documentation tells people to sign in with.
    expect(await client.user.findFirst({ where: { role: 'ADMIN' } })).toBeTruthy();
    expect(await client.user.findFirst({ where: { role: 'PRODUCER' } })).toBeTruthy();
  });
});

describe('constraints are enforced by the database, not only by the service', () => {
  it('refuses a second ledger row for the same award', async () => {
    const email = 'constraint.ledger@test.local';
    const user = await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: 'x',
        status: 'ACTIVE',
        profile: { create: { displayName: 'Ledger' } },
      },
    });

    const row = {
      userId: user.id,
      delta: 5,
      balanceAfter: 5,
      entryType: 'EARN' as const,
      sourceType: 'PREDICTION' as const,
      sourceId: 'pred_x',
      reason: 'participation',
    };

    await db.pointsLedger.create({ data: row });
    // The unique index is what makes a retried award safe, so it has to exist
    // in the database rather than in the code path that happens to check first.
    await expect(db.pointsLedger.create({ data: row })).rejects.toThrow(/unique/i);

    await db.user.delete({ where: { id: user.id } });
  });

  it('refuses two accounts with the same normalised email', async () => {
    const first = await db.user.create({
      data: {
        email: 'Dupe@Test.Local',
        emailNormalized: 'dupe@test.local',
        passwordHash: 'x',
        status: 'ACTIVE',
        profile: { create: { displayName: 'First' } },
      },
    });

    await expect(
      db.user.create({
        data: {
          email: 'd.u.p.e@test.local',
          emailNormalized: 'dupe@test.local',
          passwordHash: 'x',
          status: 'ACTIVE',
          profile: { create: { displayName: 'Second' } },
        },
      }),
    ).rejects.toThrow(/unique/i);

    await db.user.delete({ where: { id: first.id } });
  });

  it('refuses an orphan row whose parent does not exist', async () => {
    await expect(
      db.pointsLedger.create({
        data: {
          userId: 'user_that_does_not_exist',
          delta: 1,
          balanceAfter: 1,
          entryType: 'EARN',
          sourceType: 'ACHIEVEMENT',
          sourceId: 'nope',
          reason: 'nope',
        },
      }),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it('removes a user’s dependent rows with the user', async () => {
    const email = 'cascade@test.local';
    const user = await db.user.create({
      data: {
        email,
        emailNormalized: email,
        passwordHash: 'x',
        status: 'ACTIVE',
        profile: { create: { displayName: 'Cascade' } },
      },
    });
    await db.pointsLedger.create({
      data: {
        userId: user.id,
        delta: 3,
        balanceAfter: 3,
        entryType: 'EARN',
        sourceType: 'ACHIEVEMENT',
        sourceId: 'c1',
        reason: 'r1',
      },
    });

    await db.user.delete({ where: { id: user.id } });

    expect(await db.pointsLedger.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.userProfile.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('indexes exist for the reads that matter', () => {
  /**
   * Not a performance measurement — that is Phase 22's job. This only asserts
   * that the columns the hot paths filter and sort on carry an index at all,
   * because an index that was never created is a silent full scan that only
   * shows up under load.
   */
  async function indexedColumns(table: string): Promise<string> {
    const rows = await db.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = $1`,
      table,
    );
    return rows.map((row) => row.indexdef).join('\n');
  }

  it('indexes the ledger by user and by time', async () => {
    const definitions = await indexedColumns('PointsLedger');
    expect(definitions).toMatch(/userId/);
    expect(definitions).toMatch(/createdAt/);
  });

  it('enforces award idempotency with a unique index', async () => {
    const definitions = await indexedColumns('PointsLedger');
    expect(definitions).toMatch(/CREATE UNIQUE INDEX[\s\S]*userId[\s\S]*sourceType[\s\S]*sourceId/);
  });

  it('indexes the analytics log by the columns the aggregation pass reads', async () => {
    const definitions = await indexedColumns('AnalyticsEvent');
    expect(definitions).toMatch(/occurredAt|createdAt/);
    expect(definitions).toMatch(/name/);
  });

  it('indexes the audit trail by the filters the console offers', async () => {
    const definitions = await indexedColumns('AuditLog');
    expect(definitions).toMatch(/createdAt/);
    expect(definitions).toMatch(/action|module|actorId/);
  });

  it('makes one vote per user per poll a database rule', async () => {
    const definitions = await indexedColumns('PollVote');
    expect(definitions).toMatch(/CREATE UNIQUE INDEX[\s\S]*pollId[\s\S]*userId/);
  });
});
