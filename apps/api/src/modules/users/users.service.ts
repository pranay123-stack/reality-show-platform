import { ERROR_CODES, type AuthUser, type UpdateProfileInput } from '@reality/shared';

import { conflict, notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';
import { toAuthUser } from '../auth/auth.service.js';

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<AuthUser> {
  if (input.displayName) {
    const taken = await prisma.userProfile.findFirst({
      where: { displayName: input.displayName, userId: { not: userId } },
      select: { id: true },
    });
    if (taken) throw conflict(ERROR_CODES.CONFLICT, 'That display name is already taken');
  }

  await prisma.userProfile.update({
    where: { userId },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });

  return toAuthUser(user);
}

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  country: string | null;
  pointsBalance: number;
  lifetimePoints: number;
  memberSince: string;
}

export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } },
    select: {
      id: true,
      createdAt: true,
      profile: {
        select: {
          displayName: true,
          avatarUrl: true,
          bio: true,
          country: true,
          pointsBalance: true,
          lifetimePoints: true,
        },
      },
    },
  });

  if (!user?.profile) throw notFound('That profile does not exist');

  return {
    id: user.id,
    displayName: user.profile.displayName,
    avatarUrl: user.profile.avatarUrl,
    bio: user.profile.bio,
    country: user.profile.country,
    pointsBalance: user.profile.pointsBalance,
    lifetimePoints: user.profile.lifetimePoints,
    memberSince: user.createdAt.toISOString(),
  };
}
