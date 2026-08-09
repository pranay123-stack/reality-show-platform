import { PrismaClient } from '@prisma/client';

import { getConfig } from './config.js';

/**
 * One PrismaClient per process. `globalThis` caching keeps `tsx watch` reloads
 * from opening a new connection pool on every file change.
 */
const globalForPrisma = globalThis as unknown as { __realityPrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  const config = getConfig();
  return new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log: config.isDevelopment ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.__realityPrisma ?? createPrismaClient();

if (!getConfig().isProduction) {
  globalForPrisma.__realityPrisma = prisma;
}

export async function checkDatabase(client: PrismaClient = prisma): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function disconnectPrisma(client: PrismaClient = prisma): Promise<void> {
  await client.$disconnect();
}

/** Prisma's transaction client type, used by services that must stay transaction-aware. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type PrismaLike = PrismaClient | PrismaTransaction;
