import type { DuplicateSignalType, Prisma } from '@prisma/client';

import { prisma, type PrismaLike } from '../../core/prisma.js';

/**
 * Layered duplicate-account detection.
 *
 * Layer 1 (hard)     — unique email, unique normalised email, unique verified phone.
 *                      Enforced by database constraints; signup simply fails.
 * Layer 2 (hard)     — email verification: an unverified account cannot take part.
 * Layer 3 (soft)     — coarse device/session correlation, recorded as advisory
 *                      `DuplicateSignal` rows for a moderator to review.
 *
 * The soft layer never blocks anybody and never bans anybody automatically. It
 * uses only request-level signals (user agent, language, network prefix) — no
 * canvas/WebGL/audio fingerprinting, no advertising identifiers, no cross-site
 * tracking, and nothing beyond what the request already carries.
 */

export interface DeviceSignals {
  deviceHash: string;
  userAgent?: string;
  ipHash?: string | null;
}

/**
 * Records the device a signup came from and raises a signal when the same device
 * has already produced other accounts.
 */
export async function registerDeviceAndDetect(
  userId: string,
  signals: DeviceSignals,
  client: PrismaLike = prisma,
): Promise<{ relatedAccounts: number }> {
  await client.userDevice.upsert({
    where: { userId_deviceHash: { userId, deviceHash: signals.deviceHash } },
    update: { lastSeenAt: new Date(), userAgent: signals.userAgent },
    create: { userId, deviceHash: signals.deviceHash, userAgent: signals.userAgent },
  });

  const others = await client.userDevice.findMany({
    where: { deviceHash: signals.deviceHash, userId: { not: userId } },
    select: { userId: true },
    take: 20,
  });

  if (others.length === 0) return { relatedAccounts: 0 };

  // Score grows with the number of accounts sharing the device, but a shared
  // household or campus network is a perfectly ordinary explanation, so this is
  // capped well below anything that could read as proof.
  const score = Math.min(0.2 + others.length * 0.15, 0.85);

  for (const other of others) {
    await recordSignal(
      {
        userId,
        relatedUserId: other.userId,
        type: 'DEVICE_REUSE',
        score,
        details: {
          sharedDeviceHash: signals.deviceHash,
          note: 'Coarse device correlation. Shared networks and shared computers produce this legitimately.',
        },
      },
      client,
    );
  }

  return { relatedAccounts: others.length };
}

/** Raised when someone signs up with an alias of an address already in use. */
export async function recordEmailAliasSignal(
  userId: string,
  relatedUserId: string,
  submittedEmail: string,
  client: PrismaLike = prisma,
): Promise<void> {
  await recordSignal(
    {
      userId,
      relatedUserId,
      type: 'EMAIL_ALIAS',
      score: 0.9,
      details: { submittedEmail, note: 'Signup used a provider alias of an existing address.' },
    },
    client,
  );
}

export async function recordSignal(
  input: {
    userId: string;
    relatedUserId?: string | null;
    type: DuplicateSignalType;
    score: number;
    details?: Record<string, unknown>;
  },
  client: PrismaLike = prisma,
): Promise<void> {
  await client.duplicateSignal.create({
    data: {
      userId: input.userId,
      relatedUserId: input.relatedUserId ?? null,
      type: input.type,
      score: input.score,
      ...(input.details ? { details: input.details as Prisma.InputJsonValue } : {}),
    },
  });
}

/** Moderator view: unreviewed suspicions, highest score first. */
export async function listOpenSignals(limit = 50, client: PrismaLike = prisma) {
  return client.duplicateSignal.findMany({
    where: { reviewedAt: null },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      user: { select: { id: true, email: true, createdAt: true, status: true } },
      relatedUser: { select: { id: true, email: true, createdAt: true, status: true } },
    },
  });
}
