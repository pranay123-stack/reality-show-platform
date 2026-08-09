import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  type CommunityView,
  type ConnectionView,
  type LeaderboardMeView,
  type LeaderboardRowView,
  type LeaderboardScope,
  type LeaderboardView,
  type LeaderboardWindow,
  type RankingExplanationView,
} from '@reality/shared';

import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { emitDomainEvent } from '../../core/domain-events.js';
import { prisma } from '../../core/prisma.js';
import { redis } from '../../core/redis.js';
import { boundsForKey, periodBounds } from './periods.js';
import {
  LEADERBOARD_KEYS as KEY,
  boardTimezone,
  communityIdsFor,
  flushLeaderboardCache,
  invalidateMemberships,
  isFrozen,
  rebuild,
  setFrozen,
  syncLeaderboards,
} from './projector.js';
import { leaderboardDelta, movementFrom, percentileFor, rankFromAhead } from './ranking.js';

/**
 * Leaderboard reads.
 *
 * Every ranking here is answered from the Redis sorted sets the projector
 * maintains. Nothing in this file aggregates activity tables, and nothing
 * recomputes a board on the request path — that is the entire point of the
 * projection existing.
 *
 * The one database read on a hot path is the batch of display names for the
 * page being rendered, which is bounded by the page size.
 */

// ---------------------------------------------------------------------------
// Rank primitives
// ---------------------------------------------------------------------------

/**
 * Competition rank: one more than the number of users strictly ahead.
 *
 * `ZCOUNT` answers that in O(log N) without materialising the board, so rank
 * 40 000 costs the same as rank 3, and ties naturally share a rank.
 */
async function rankFor(boardKey: string, score: number): Promise<number> {
  const ahead = await redis.zcount(boardKey, `(${score}`, '+inf');
  return rankFromAhead(ahead);
}

async function scoreFor(boardKey: string, userId: string): Promise<number | null> {
  const raw = await redis.zscore(boardKey, userId);
  return raw === null ? null : Number(raw);
}

interface ScoredMember {
  userId: string;
  points: number;
  firstScoredAt: number;
}

/** Orders a page of ties deterministically: earliest scorer first. */
function orderPage(members: ScoredMember[]): ScoredMember[] {
  return [...members].sort(
    (a, b) =>
      b.points - a.points ||
      a.firstScoredAt - b.firstScoredAt ||
      a.userId.localeCompare(b.userId),
  );
}

async function firstScoredMap(
  window: LeaderboardWindow,
  periodKey: string,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const values = await redis.hmget(KEY.firstScored(window, periodKey), ...userIds);
  return new Map(userIds.map((id, index) => [id, Number(values[index] ?? 0)]));
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

interface ProfileRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  leaderboardVisible: boolean;
}

async function profilesFor(userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, displayName: true, avatarUrl: true, leaderboardVisible: true },
  });
  return new Map(profiles.map((profile) => [profile.userId, profile]));
}

/**
 * Builds display rows, dropping users who opted out.
 *
 * Hiding happens *after* ranking, never before: a user who opts out still holds
 * their true position, they simply are not listed. Removing them from the
 * ranking itself would silently promote everyone below them and make the number
 * a lie.
 */
async function toRows(
  window: LeaderboardWindow,
  periodKey: string,
  members: ScoredMember[],
  boardKey: string,
  viewerId: string | null,
  previousRanks: Map<string, number>,
): Promise<LeaderboardRowView[]> {
  const profiles = await profilesFor(members.map((member) => member.userId));
  const rows: LeaderboardRowView[] = [];

  for (const member of members) {
    const profile = profiles.get(member.userId);
    if (!profile) continue;

    const isYou = member.userId === viewerId;
    if (!profile.leaderboardVisible && !isYou) continue;

    const rank = await rankFor(boardKey, member.points);
    const previousRank = previousRanks.get(member.userId) ?? null;

    rows.push({
      rank,
      userId: member.userId,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      points: member.points,
      previousRank,
      movement: movementFrom(previousRank, rank),
      isYou,
    });
  }

  return rows;
}

/** Previous ranks come from the last snapshot — the only honest "before". */
async function previousRanksFor(
  type: LeaderboardScope,
  periodKey: string,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const snapshot = await prisma.leaderboard.findFirst({
    where: { type: type as never, periodKey },
    orderBy: { computedAt: 'desc' },
    select: { id: true },
  });
  if (!snapshot) return new Map();

  const entries = await prisma.leaderboardEntry.findMany({
    where: { leaderboardId: snapshot.id, userId: { in: userIds } },
    select: { userId: true, rank: true },
  });
  return new Map(entries.map((entry) => [entry.userId, entry.rank]));
}

// ---------------------------------------------------------------------------
// The global boards: daily, weekly, season
// ---------------------------------------------------------------------------

export interface ReadOptions {
  window: LeaderboardWindow;
  offset: number;
  limit: number;
  periodKey?: string;
}

function resolveBounds(window: LeaderboardWindow, periodKey?: string) {
  const timezone = boardTimezone();
  const bounds = periodKey
    ? boundsForKey(window, periodKey, timezone)
    : periodBounds(window, new Date(), timezone);

  if (!bounds) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: `"${periodKey}" is not a valid ${window.toLowerCase()} period`,
      statusCode: 400,
    });
  }
  return { bounds, timezone };
}

export async function getLeaderboard(
  viewerId: string | null,
  options: ReadOptions,
): Promise<LeaderboardView> {
  const { bounds, timezone } = resolveBounds(options.window, options.periodKey);
  const boardKey = KEY.board(options.window, bounds.key);

  const [total, frozen] = await Promise.all([
    redis.zcard(boardKey),
    isFrozen(options.window, bounds.key),
  ]);

  // Over-fetch a little so hidden users do not leave short pages.
  const raw = await redis.zrevrange(
    boardKey,
    options.offset,
    options.offset + options.limit * 2 - 1,
    'WITHSCORES',
  );

  const members = pairsToMembers(raw);
  const firstScored = await firstScoredMap(
    options.window,
    bounds.key,
    members.map((member) => member.userId),
  );
  for (const member of members) member.firstScoredAt = firstScored.get(member.userId) ?? 0;

  const previousRanks = await previousRanksFor(
    options.window,
    bounds.key,
    members.map((member) => member.userId),
  );

  const rows = (
    await toRows(options.window, bounds.key, orderPage(members), boardKey, viewerId, previousRanks)
  ).slice(0, options.limit);

  return {
    scope: options.window,
    window: options.window,
    periodKey: bounds.key,
    timezone,
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end?.toISOString() ?? null,
    totalRanked: total,
    frozen,
    rows,
    me: viewerId ? await getMyPosition(viewerId, options.window, bounds.key, boardKey) : null,
  };
}

function pairsToMembers(raw: string[]): ScoredMember[] {
  const members: ScoredMember[] = [];
  for (let index = 0; index < raw.length; index += 2) {
    members.push({
      userId: raw[index]!,
      points: Number(raw[index + 1]),
      firstScoredAt: 0,
    });
  }
  return members;
}

export async function getMyPosition(
  userId: string,
  window: LeaderboardWindow,
  periodKey: string,
  boardKey = KEY.board(window, periodKey),
): Promise<LeaderboardMeView> {
  const [score, total, profile] = await Promise.all([
    scoreFor(boardKey, userId),
    redis.zcard(boardKey),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { leaderboardVisible: true },
    }),
  ]);

  if (score === null) {
    return {
      rank: null,
      points: 0,
      movement: null,
      previousRank: null,
      percentile: null,
      hidden: profile?.leaderboardVisible === false,
    };
  }

  const rank = await rankFor(boardKey, score);
  const previous = await previousRanksFor(window, periodKey, [userId]);
  const previousRank = previous.get(userId) ?? null;

  return {
    rank,
    points: score,
    previousRank,
    movement: movementFrom(previousRank, rank),
    percentile: percentileFor(rank, total),
    hidden: profile?.leaderboardVisible === false,
  };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

/**
 * Mutual, accepted friendships only.
 *
 * A follow is one-sided: letting it into this list would let anyone insert
 * themselves into a stranger's private ranking simply by following them.
 */
export async function friendIdsFor(userId: string): Promise<string[]> {
  const connections = await prisma.userConnection.findMany({
    where: {
      kind: 'FRIEND',
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });

  return connections.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId));
}

/**
 * The friends board.
 *
 * Scored by `ZMSCORE` against the global board rather than a per-user sorted
 * set: friend lists are small and change constantly, so maintaining one zset
 * per user would be a large amount of write amplification for a read that is
 * already cheap.
 */
export async function getFriendsLeaderboard(
  viewerId: string,
  options: ReadOptions,
): Promise<LeaderboardView> {
  const { bounds, timezone } = resolveBounds(options.window, options.periodKey);
  const boardKey = KEY.board(options.window, bounds.key);

  const friendIds = await friendIdsFor(viewerId);
  const circle = [...new Set([viewerId, ...friendIds])];

  const scores = circle.length > 0 ? await redis.zmscore(boardKey, ...circle) : [];
  const members: ScoredMember[] = circle
    .map((userId, index) => ({
      userId,
      points: Number(scores[index] ?? 0),
      firstScoredAt: 0,
    }))
    .filter((member) => Number.isFinite(member.points));

  const firstScored = await firstScoredMap(
    options.window,
    bounds.key,
    members.map((member) => member.userId),
  );
  for (const member of members) member.firstScoredAt = firstScored.get(member.userId) ?? 0;

  const ordered = orderPage(members);
  const profiles = await profilesFor(ordered.map((member) => member.userId));

  // Ranks are relative to the circle, not the world — inside your own friends
  // list "#1" should mean first among friends.
  const rows: LeaderboardRowView[] = [];
  let lastPoints: number | null = null;
  let lastRank = 0;

  ordered.forEach((member, index) => {
    const profile = profiles.get(member.userId);
    if (!profile) return;
    const rank = member.points === lastPoints ? lastRank : index + 1;
    lastPoints = member.points;
    lastRank = rank;

    rows.push({
      rank,
      userId: member.userId,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      points: member.points,
      previousRank: null,
      movement: null,
      isYou: member.userId === viewerId,
    });
  });

  const page = rows.slice(options.offset, options.offset + options.limit);
  const mine = rows.find((row) => row.isYou);

  return {
    scope: 'FRIENDS',
    window: options.window,
    periodKey: bounds.key,
    timezone,
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end?.toISOString() ?? null,
    totalRanked: rows.length,
    frozen: await isFrozen(options.window, bounds.key),
    rows: page,
    me: {
      rank: mine?.rank ?? null,
      points: mine?.points ?? 0,
      previousRank: null,
      movement: null,
      percentile: mine ? percentileFor(mine.rank, rows.length) : null,
      hidden: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

export async function getCommunityLeaderboard(
  viewerId: string | null,
  communityId: string,
  options: ReadOptions,
): Promise<LeaderboardView> {
  const community = await prisma.community.findFirst({
    where: { id: communityId, deletedAt: null },
    select: { id: true, name: true, slug: true, memberCount: true, isPrivate: true },
  });
  if (!community) throw notFound('That community does not exist');

  if (community.isPrivate) {
    const member = viewerId
      ? await prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId, userId: viewerId } },
          select: { id: true },
        })
      : null;
    if (!member) throw forbidden('This community’s ranking is private to its members');
  }

  const { bounds, timezone } = resolveBounds(options.window, options.periodKey);
  const boardKey = KEY.community(communityId, options.window, bounds.key);

  const total = await redis.zcard(boardKey);
  const raw = await redis.zrevrange(
    boardKey,
    options.offset,
    options.offset + options.limit * 2 - 1,
    'WITHSCORES',
  );

  const members = pairsToMembers(raw);
  const firstScored = await firstScoredMap(
    options.window,
    bounds.key,
    members.map((member) => member.userId),
  );
  for (const member of members) member.firstScoredAt = firstScored.get(member.userId) ?? 0;

  const rows = (
    await toRows(options.window, bounds.key, orderPage(members), boardKey, viewerId, new Map())
  ).slice(0, options.limit);

  return {
    scope: 'COMMUNITY',
    window: options.window,
    periodKey: bounds.key,
    timezone,
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end?.toISOString() ?? null,
    totalRanked: total,
    frozen: await isFrozen(options.window, bounds.key),
    rows,
    me: viewerId ? await getMyPosition(viewerId, options.window, bounds.key, boardKey) : null,
    community,
  };
}

export async function listCommunities(
  viewerId: string | null,
  options: { typeKey?: string; mine?: boolean; limit: number },
): Promise<CommunityView[]> {
  const joinedIds = viewerId ? new Set(await communityIdsFor(viewerId)) : new Set<string>();

  const communities = await prisma.community.findMany({
    where: {
      deletedAt: null,
      ...(options.typeKey ? { type: { key: options.typeKey } } : {}),
      ...(options.mine && viewerId ? { id: { in: [...joinedIds] } } : {}),
      // A private community is not advertised to people who are not in it.
      ...(options.mine ? {} : { OR: [{ isPrivate: false }, { id: { in: [...joinedIds] } }] }),
    },
    include: { type: { select: { key: true, label: true } } },
    orderBy: [{ memberCount: 'desc' }, { name: 'asc' }],
    take: options.limit,
  });

  return communities.map((community) => ({
    id: community.id,
    slug: community.slug,
    name: community.name,
    description: community.description,
    type: community.type,
    isPrivate: community.isPrivate,
    memberCount: community.memberCount,
    joined: joinedIds.has(community.id),
  }));
}

export async function joinCommunity(communityId: string, userId: string): Promise<void> {
  const community = await prisma.community.findFirst({
    where: { id: communityId, deletedAt: null },
    select: { id: true, isPrivate: true },
  });
  if (!community) throw notFound('That community does not exist');
  if (community.isPrivate) {
    throw forbidden('This community is invitation only');
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.communityMember.createMany({
      data: { communityId, userId },
      skipDuplicates: true,
    });
    if (created.count > 0) {
      await tx.community.update({
        where: { id: communityId },
        data: { memberCount: { increment: 1 } },
      });
    }
  });

  await invalidateMemberships(userId);
  // The new member's existing score has to appear on the community board, and
  // the only honest way to get it there is to recompute from the ledger.
  await rebuildCommunityFor(userId);
}

export async function leaveCommunity(communityId: string, userId: string): Promise<void> {
  const removed = await prisma.communityMember.deleteMany({ where: { communityId, userId } });
  if (removed.count === 0) throw notFound('You are not in that community');

  await prisma.community.update({
    where: { id: communityId },
    data: { memberCount: { decrement: 1 } },
  });
  await invalidateMemberships(userId);

  const timezone = boardTimezone();
  const pipeline = redis.multi();
  for (const window of ['DAILY', 'WEEKLY', 'SEASON'] as LeaderboardWindow[]) {
    const bounds = periodBounds(window, new Date(), timezone);
    pipeline.zrem(KEY.community(communityId, window, bounds.key), userId);
  }
  await pipeline.exec();
}

/** Places a user's current scores onto every community board they belong to. */
async function rebuildCommunityFor(userId: string): Promise<void> {
  const timezone = boardTimezone();
  const communityIds = await communityIdsFor(userId);
  if (communityIds.length === 0) return;

  const pipeline = redis.multi();
  for (const window of ['DAILY', 'WEEKLY', 'SEASON'] as LeaderboardWindow[]) {
    const bounds = periodBounds(window, new Date(), timezone);
    const score = await scoreFor(KEY.board(window, bounds.key), userId);
    if (score === null) continue;
    for (const communityId of communityIds) {
      pipeline.zadd(KEY.community(communityId, window, bounds.key), score, userId);
    }
  }
  await pipeline.exec();
}

// ---------------------------------------------------------------------------
// Connections & privacy
// ---------------------------------------------------------------------------

export async function requestConnection(
  requesterId: string,
  addresseeId: string,
  kind: 'FRIEND' | 'FOLLOW',
): Promise<ConnectionView> {
  if (requesterId === addresseeId) {
    throw new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'You cannot connect to yourself',
      statusCode: 400,
    });
  }

  const target = await prisma.user.findFirst({
    where: { id: addresseeId, deletedAt: null },
    select: { id: true, profile: { select: { profileVisibility: true } } },
  });
  if (!target) throw notFound('That user does not exist');

  if (kind === 'FOLLOW' && target.profile?.profileVisibility === 'PRIVATE') {
    throw forbidden('That profile is private');
  }

  // A blocked edge in either direction ends the conversation.
  const blocked = await prisma.userConnection.findFirst({
    where: {
      status: 'BLOCKED',
      OR: [
        { requesterId, addresseeId },
        { requesterId: addresseeId, addresseeId: requesterId },
      ],
    },
    select: { id: true },
  });
  if (blocked) throw forbidden('That connection is not available');

  const existing = await prisma.userConnection.findUnique({
    where: { requesterId_addresseeId_kind: { requesterId, addresseeId, kind } },
  });
  if (existing) throw conflict(ERROR_CODES.CONFLICT, 'That request already exists');

  const connection = await prisma.userConnection.create({
    data: {
      requesterId,
      addresseeId,
      kind,
      // Following needs nobody's permission; friendship does.
      status: kind === 'FOLLOW' ? 'ACCEPTED' : 'PENDING',
      ...(kind === 'FOLLOW' ? { respondedAt: new Date() } : {}),
    },
    include: { addressee: { select: { id: true, profile: true } } },
  });

  return {
    id: connection.id,
    kind: connection.kind,
    status: connection.status,
    direction: 'outgoing',
    user: {
      id: connection.addressee.id,
      displayName: connection.addressee.profile?.displayName ?? 'Unknown',
      avatarUrl: connection.addressee.profile?.avatarUrl ?? null,
    },
    createdAt: connection.createdAt.toISOString(),
  };
}

export async function respondToConnection(
  connectionId: string,
  userId: string,
  accept: boolean,
): Promise<ConnectionView> {
  const connection = await prisma.userConnection.findUnique({
    where: { id: connectionId },
    include: { requester: { select: { id: true, profile: true } } },
  });
  if (!connection) throw notFound('That request does not exist');
  // Only the person who received the request may answer it.
  if (connection.addresseeId !== userId) throw forbidden('That is not your request');
  if (connection.status !== 'PENDING') {
    throw conflict(ERROR_CODES.CONFLICT, 'That request has already been answered');
  }

  const updated = await prisma.userConnection.update({
    where: { id: connectionId },
    data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() },
  });

  return {
    id: updated.id,
    kind: updated.kind,
    status: updated.status,
    direction: 'incoming',
    user: {
      id: connection.requester.id,
      displayName: connection.requester.profile?.displayName ?? 'Unknown',
      avatarUrl: connection.requester.profile?.avatarUrl ?? null,
    },
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  const connections = await prisma.userConnection.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: {
      requester: { select: { id: true, profile: true } },
      addressee: { select: { id: true, profile: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return connections.map((connection) => {
    const outgoing = connection.requesterId === userId;
    const other = outgoing ? connection.addressee : connection.requester;
    return {
      id: connection.id,
      kind: connection.kind,
      status: connection.status,
      direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
      user: {
        id: other.id,
        displayName: other.profile?.displayName ?? 'Unknown',
        avatarUrl: other.profile?.avatarUrl ?? null,
      },
      createdAt: connection.createdAt.toISOString(),
    };
  });
}

export async function updatePrivacy(
  userId: string,
  input: { leaderboardVisible?: boolean; profileVisibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE' },
) {
  const profile = await prisma.userProfile.update({
    where: { userId },
    data: {
      ...(input.leaderboardVisible !== undefined
        ? { leaderboardVisible: input.leaderboardVisible }
        : {}),
      ...(input.profileVisibility ? { profileVisibility: input.profileVisibility } : {}),
    },
    select: { leaderboardVisible: true, profileVisibility: true },
  });
  return profile;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Find-or-create for a board row.
 *
 * Not `upsert`: the unique key includes the nullable `showId`, and Prisma
 * cannot target a NULL through a compound unique `where`. The unique index
 * still protects against a concurrent double-create, so the create is retried
 * as an update if it loses that race.
 */
async function upsertBoardRow(
  window: LeaderboardWindow,
  periodKey: string,
  data: Prisma.LeaderboardUncheckedUpdateInput,
): Promise<{ id: string }> {
  const existing = await prisma.leaderboard.findFirst({
    where: { type: window as never, periodKey, showId: null },
    select: { id: true },
  });

  if (existing) {
    return prisma.leaderboard.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  }

  try {
    return await prisma.leaderboard.create({
      data: { type: window as never, periodKey, ...data } as Prisma.LeaderboardUncheckedCreateInput,
      select: { id: true },
    });
  } catch {
    const raced = await prisma.leaderboard.findFirstOrThrow({
      where: { type: window as never, periodKey, showId: null },
      select: { id: true },
    });
    return prisma.leaderboard.update({ where: { id: raced.id }, data, select: { id: true } });
  }
}

/**
 * Freezes the live board into the database.
 *
 * This is what makes rank movement possible: "up 3" is only meaningful against
 * a previous, recorded position. It is also the historical record that outlives
 * the cache.
 */
export async function snapshotLeaderboard(
  window: LeaderboardWindow,
  periodKey?: string,
): Promise<{ id: string; entryCount: number }> {
  const { bounds, timezone } = resolveBounds(window, periodKey);
  const boardKey = KEY.board(window, bounds.key);

  const raw = await redis.zrevrange(boardKey, 0, 9_999, 'WITHSCORES');
  const members = pairsToMembers(raw);
  const firstScored = await firstScoredMap(
    window,
    bounds.key,
    members.map((member) => member.userId),
  );

  const previous = await previousRanksFor(
    window,
    bounds.key,
    members.map((member) => member.userId),
  );

  const ordered = orderPage(
    members.map((member) => ({
      ...member,
      firstScoredAt: firstScored.get(member.userId) ?? 0,
    })),
  );

  let lastPoints: number | null = null;
  let lastRank = 0;
  const entries = ordered.map((member, index) => {
    const rank = member.points === lastPoints ? lastRank : index + 1;
    lastPoints = member.points;
    lastRank = rank;
    const previousRank = previous.get(member.userId) ?? null;

    return {
      userId: member.userId,
      rank,
      points: member.points,
      tieBreaker: member.firstScoredAt ? new Date(member.firstScoredAt) : null,
      previousRank,
      movement: movementFrom(previousRank, rank),
    };
  });

  const totalPoints = entries.reduce((sum, entry) => sum + entry.points, 0);
  const board = await upsertBoardRow(window, bounds.key, {
    timezone,
    computedAt: new Date(),
    entryCount: entries.length,
    totalPoints,
  });

  // Replace wholesale: a snapshot is a picture of one moment, not a merge of
  // several.
  await prisma.$transaction([
    prisma.leaderboardEntry.deleteMany({ where: { leaderboardId: board.id } }),
    prisma.leaderboardEntry.createMany({
      data: entries.map((entry) => ({ ...entry, leaderboardId: board.id })),
    }),
  ]);

  await announceMovement(window, bounds.key, entries);

  return { id: board.id, entryCount: entries.length };
}

/**
 * How far someone must move before it is worth interrupting them.
 *
 * A leaderboard shuffles constantly; telling a user about every single-place
 * wobble would train them to ignore the bell entirely. Three places is enough to
 * feel like something happened, and reaching the top ten always is.
 */
const MOVEMENT_THRESHOLD = 3;
const TOP_TIER = 10;

/** Round numbers worth being told about, in points earned this season. */
const MILESTONES = [1000, 5000, 10_000, 25_000, 50_000, 100_000];

async function announceMovement(
  window: LeaderboardWindow,
  periodKey: string,
  entries: {
    userId: string;
    rank: number;
    points: number;
    previousRank: number | null;
    movement: number | null;
  }[],
): Promise<void> {
  for (const entry of entries) {
    const moved = entry.movement;
    if (moved !== null && Math.abs(moved) >= MOVEMENT_THRESHOLD) {
      const enteringTopTier = entry.rank <= TOP_TIER && (entry.previousRank ?? 999) > TOP_TIER;
      if (moved > 0 || !enteringTopTier) {
        await emitDomainEvent({
          event: moved > 0 ? 'leaderboard.rank_up' : 'leaderboard.rank_down',
          entityId: entry.userId,
          // One telling per user per board period — not per snapshot, or a
          // five-minute rebuild cadence would notify twelve times an hour.
          variant: `${window}:${periodKey}:${entry.rank}`,
          payload: {
            userId: entry.userId,
            rank: entry.rank,
            places: Math.abs(moved),
            window: window.toLowerCase(),
          },
        });
      }
    }

    // Milestones are on the season board only: passing 5 000 points "today" is
    // not a milestone, it is a good afternoon.
    if (window === 'SEASON') {
      const passed = MILESTONES.filter((milestone) => entry.points >= milestone).at(-1);
      if (passed) {
        await emitDomainEvent({
          event: 'leaderboard.milestone',
          entityId: entry.userId,
          variant: String(passed),
          payload: { userId: entry.userId, milestone: passed },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function rebuildLeaderboard(window: LeaderboardWindow, periodKey?: string) {
  const { bounds } = resolveBounds(window, periodKey);
  return rebuild(window, bounds);
}

export async function rebuildEverything() {
  await flushLeaderboardCache();
  const timezone = boardTimezone();
  const results = [];
  for (const window of ['DAILY', 'WEEKLY', 'SEASON'] as LeaderboardWindow[]) {
    results.push(await rebuild(window, periodBounds(window, new Date(), timezone)));
  }
  return results;
}

export async function freezeLeaderboard(
  window: LeaderboardWindow,
  frozen: boolean,
  actorId: string,
  periodKey?: string,
) {
  const { bounds } = resolveBounds(window, periodKey);
  await setFrozen(window, bounds.key, frozen);

  await upsertBoardRow(window, bounds.key, {
    timezone: boardTimezone(),
    frozenAt: frozen ? new Date() : null,
    frozenById: frozen ? actorId : null,
  });

  // Entries that arrived while frozen were deliberately not applied, so the
  // board is behind the ledger. Rebuilding is the only way back to the truth.
  if (!frozen) await rebuild(window, bounds);

  return { window, periodKey: bounds.key, frozen };
}

/**
 * The audit view: what a rank is actually made of.
 *
 * Recomputes the score straight from the ledger and reports it beside the
 * cached one. An administrator investigating "why is this user #1" gets the
 * contributing rows and a consistency verdict, not an assurance.
 */
export async function explainRanking(
  userId: string,
  window: LeaderboardWindow,
  periodKey?: string,
): Promise<RankingExplanationView> {
  const { bounds, timezone } = resolveBounds(window, periodKey);
  const boardKey = KEY.board(window, bounds.key);

  const [profile, cached, entries] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId }, select: { displayName: true } }),
    scoreFor(boardKey, userId),
    prisma.pointsLedger.findMany({
      where: {
        userId,
        createdAt: { gte: bounds.start, ...(bounds.end ? { lt: bounds.end } : {}) },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  if (!profile) throw notFound('That user does not exist');

  const ledgerScore = entries.reduce((sum, entry) => sum + leaderboardDelta(entry), 0);
  const cachedScore = cached ?? 0;

  return {
    userId,
    displayName: profile.displayName,
    window,
    periodKey: bounds.key,
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end?.toISOString() ?? null,
    timezone,
    rank: cached === null ? null : await rankFor(boardKey, cached),
    cachedScore,
    ledgerScore,
    consistent: cachedScore === ledgerScore,
    entryCount: entries.length,
    contributions: entries
      .filter((entry) => leaderboardDelta(entry) !== 0)
      .slice(0, 50)
      .map((entry) => ({
        sourceType: entry.sourceType,
        reason: entry.reason,
        delta: leaderboardDelta(entry),
        entryType: entry.entryType,
        at: entry.createdAt.toISOString(),
      })),
  };
}

export async function exportLeaderboard(
  window: LeaderboardWindow,
  options: { periodKey?: string; limit: number },
) {
  const { bounds, timezone } = resolveBounds(window, options.periodKey);
  const boardKey = KEY.board(window, bounds.key);

  const raw = await redis.zrevrange(boardKey, 0, options.limit - 1, 'WITHSCORES');
  const members = pairsToMembers(raw);
  const profiles = await profilesFor(members.map((member) => member.userId));

  let lastPoints: number | null = null;
  let lastRank = 0;

  return {
    window,
    periodKey: bounds.key,
    timezone,
    exportedAt: new Date().toISOString(),
    rows: members.map((member, index) => {
      const rank = member.points === lastPoints ? lastRank : index + 1;
      lastPoints = member.points;
      lastRank = rank;
      return {
        rank,
        userId: member.userId,
        displayName: profiles.get(member.userId)?.displayName ?? 'Unknown',
        points: member.points,
      };
    }),
  };
}

export function toCsv(payload: Awaited<ReturnType<typeof exportLeaderboard>>): string {
  const header = 'rank,userId,displayName,points';
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = payload.rows.map(
    (row) => `${row.rank},${escape(row.userId)},${escape(row.displayName)},${row.points}`,
  );
  return [header, ...lines].join('\n');
}

export { syncLeaderboards };

/** Community administration — types are data, so producers add them at runtime. */
export async function createCommunityType(input: {
  key: string;
  label: string;
  description?: string;
}) {
  const existing = await prisma.communityType.findUnique({ where: { key: input.key } });
  if (existing) throw conflict(ERROR_CODES.CONFLICT, 'That community type already exists');
  return prisma.communityType.create({ data: input });
}

export async function listCommunityTypes() {
  return prisma.communityType.findMany({
    where: { active: true },
    orderBy: { label: 'asc' },
    select: { id: true, key: true, label: true, description: true },
  });
}

export async function createCommunity(
  input: {
    typeKey: string;
    slug: string;
    name: string;
    description?: string;
    isPrivate: boolean;
  },
  actorId: string,
) {
  const type = await prisma.communityType.findUnique({ where: { key: input.typeKey } });
  if (!type) throw notFound('That community type does not exist');

  const existing = await prisma.community.findUnique({ where: { slug: input.slug } });
  if (existing) throw conflict(ERROR_CODES.CONFLICT, 'That slug is taken');

  return prisma.community.create({
    data: {
      typeId: type.id,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      isPrivate: input.isPrivate,
      createdById: actorId,
    } satisfies Prisma.CommunityUncheckedCreateInput,
  });
}
