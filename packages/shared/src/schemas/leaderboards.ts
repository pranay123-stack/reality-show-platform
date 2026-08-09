import { z } from 'zod';

import { idSchema } from './common';

/**
 * Leaderboards.
 *
 * Three rules shape every contract here:
 *
 *  1. **A client never sends a score or a rank.** Both are derived server-side
 *     from `PointsLedger` and nothing else. There is deliberately no input
 *     schema anywhere in this file that carries points.
 *  2. **Ranking counts *earned* points.** Spending on a reward must not drop
 *     you down the board — the same principle as Phase 14's "spending never
 *     costs you a level".
 *  3. **Period boundaries belong to the board, not the viewer.** A shared
 *     ranking needs one agreed definition of "today".
 */

export const LEADERBOARD_SCOPES = ['DAILY', 'WEEKLY', 'SEASON', 'FRIENDS', 'COMMUNITY'] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

/** The three that are genuine time windows; the other two are audience filters. */
export const LEADERBOARD_WINDOWS = ['DAILY', 'WEEKLY', 'SEASON'] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];

export const PROFILE_VISIBILITIES = ['PUBLIC', 'FRIENDS', 'PRIVATE'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const CONNECTION_KINDS = ['FRIEND', 'FOLLOW'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const CONNECTION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

// --- queries ---------------------------------------------------------------

export const leaderboardQuerySchema = z.object({
  /** Which time window to rank over. FRIENDS and COMMUNITY still need one. */
  window: z.enum(LEADERBOARD_WINDOWS).default('SEASON'),
  /** Offset paging: a ranking needs random access by rank, not a cursor. */
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const communityLeaderboardQuerySchema = leaderboardQuerySchema.extend({
  communityId: idSchema,
});

export const listCommunitiesQuerySchema = z.object({
  typeKey: z.string().trim().min(1).max(60).optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- privacy ---------------------------------------------------------------

export const updatePrivacySchema = z
  .object({
    leaderboardVisible: z.boolean().optional(),
    profileVisibility: z.enum(PROFILE_VISIBILITIES).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Nothing to change',
  });
export type UpdatePrivacyInput = z.infer<typeof updatePrivacySchema>;

// --- connections -----------------------------------------------------------

export const createConnectionSchema = z.object({
  userId: idSchema,
  kind: z.enum(CONNECTION_KINDS).default('FRIEND'),
});

export const respondConnectionSchema = z.object({
  accept: z.boolean(),
});

// --- communities -----------------------------------------------------------

export const createCommunityTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use lower-case letters, numbers and underscores'),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

export const createCommunitySchema = z.object({
  typeKey: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, numbers and hyphens'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  isPrivate: z.boolean().default(false),
});

// --- admin -----------------------------------------------------------------

export const rebuildLeaderboardSchema = z.object({
  window: z.enum(LEADERBOARD_WINDOWS),
  /** Omit for the current period. */
  periodKey: z.string().trim().min(4).max(40).optional(),
});

export const freezeLeaderboardSchema = z.object({
  window: z.enum(LEADERBOARD_WINDOWS),
  periodKey: z.string().trim().min(4).max(40).optional(),
  frozen: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const exportLeaderboardSchema = z.object({
  window: z.enum(LEADERBOARD_WINDOWS),
  periodKey: z.string().trim().min(4).max(40).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
});

export const inspectRankingQuerySchema = z.object({
  window: z.enum(LEADERBOARD_WINDOWS).default('SEASON'),
  userId: idSchema,
});

// --- views -----------------------------------------------------------------

export interface LeaderboardRowView {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  points: number;
  /** previousRank - rank. Positive is a climb; null on a first appearance. */
  movement: number | null;
  previousRank: number | null;
  /** True when this row is the requesting user. */
  isYou: boolean;
}

export interface LeaderboardMeView {
  rank: number | null;
  points: number;
  movement: number | null;
  previousRank: number | null;
  /** 0–100; higher is better. Null when the user has no points yet. */
  percentile: number | null;
  /** Whether the user has opted out of appearing publicly. */
  hidden: boolean;
}

export interface LeaderboardView {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  periodKey: string;
  /** The zone the period boundaries were computed in. */
  timezone: string;
  /** ISO timestamps bounding this period; null for a season, which has no end. */
  periodStart: string;
  periodEnd: string | null;
  totalRanked: number;
  frozen: boolean;
  rows: LeaderboardRowView[];
  me: LeaderboardMeView | null;
  community?: { id: string; name: string; slug: string; memberCount: number } | null;
}

export interface CommunityView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: { key: string; label: string };
  isPrivate: boolean;
  memberCount: number;
  joined: boolean;
}

export interface ConnectionView {
  id: string;
  kind: ConnectionKind;
  status: ConnectionStatus;
  direction: 'outgoing' | 'incoming';
  user: { id: string; displayName: string; avatarUrl: string | null };
  createdAt: string;
}

/** The audit view behind a rank — what the number is actually made of. */
export interface RankingExplanationView {
  userId: string;
  displayName: string;
  window: LeaderboardWindow;
  periodKey: string;
  periodStart: string;
  periodEnd: string | null;
  timezone: string;
  rank: number | null;
  /** Live score held in the ranking cache. */
  cachedScore: number;
  /** Score recomputed from the ledger right now. */
  ledgerScore: number;
  /** True when cache and ledger agree, which they always should. */
  consistent: boolean;
  entryCount: number;
  contributions: {
    sourceType: string;
    reason: string;
    delta: number;
    entryType: string;
    at: string;
  }[];
}
