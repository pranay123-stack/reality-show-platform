import { z } from 'zod';

import { CONTESTANT_STATUSES } from '../enums';
import { idSchema } from './common';

/**
 * The operator console.
 *
 * Almost nothing here is new business logic — the console drives the same
 * endpoints the rest of the platform already exposes. What lives in this file
 * is the small amount that only an operator needs: contestant management, an
 * aggregated overview, and a reader for the audit trail.
 */

// ---------------------------------------------------------------------------
// Contestants
// ---------------------------------------------------------------------------

export const createContestantSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, numbers and hyphens'),
  tagline: z.string().trim().max(160).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  age: z.number().int().min(16).max(120).nullable().optional(),
  occupation: z.string().trim().max(120).nullable().optional(),
  hometown: z.string().trim().max(120).nullable().optional(),
});
export type CreateContestantInput = z.infer<typeof createContestantSchema>;

/** Slug is omitted: a public identifier that changes breaks every shared link. */
export const updateContestantSchema = createContestantSchema.partial().omit({ slug: true });

export const setContestantStatusSchema = z.object({
  status: z.enum(CONTESTANT_STATUSES),
  /** Recorded on the audit row so a status change is never unexplained. */
  reason: z.string().trim().max(300).optional(),
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Modules an audit row can belong to.
 *
 * Derived from the action prefix (`poll.close` → `poll`) rather than stored, so
 * a new audited action appears in the filter automatically.
 */
export const AUDIT_MODULES = [
  'auth',
  'user',
  'role',
  'contestant',
  'prediction',
  'poll',
  'challenge',
  'perspective',
  'nomination',
  'eviction',
  'round',
  'official',
  'kitchen',
  'weekend',
  'reward',
  'leaderboard',
  'community',
  'notification',
  'points',
  'system',
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

export const auditQuerySchema = z.object({
  actorId: idSchema.optional(),
  /** Substring match on the action, e.g. "close". */
  action: z.string().trim().max(80).optional(),
  module: z.string().trim().max(40).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(80).optional(),
  /** ISO dates. Inclusive from, exclusive to. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AuditEntryView {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; displayName: string; email: string; role: string } | null;
  actorRole: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
}

export interface AuditFeedView {
  items: AuditEntryView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AuditFacetsView {
  actions: string[];
  modules: string[];
  entityTypes: string[];
  actors: { id: string; displayName: string; role: string }[];
}

export interface OverviewCard {
  key: string;
  label: string;
  value: number;
  /** Secondary line, e.g. "3 closing within the hour". */
  detail?: string;
  /** Drives the visual accent: something needing attention reads differently. */
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  href?: string;
}

export interface AdminOverviewView {
  generatedAt: string;
  show: { id: string; name: string; isLive: boolean; episode: string | null } | null;
  /** Everything the operator can see at a glance. */
  cards: OverviewCard[];
  participation: {
    /** Distinct users with any recorded action, per day, oldest first. */
    days: { date: string; users: number; actions: number }[];
  };
  moderation: {
    challenges: number;
    weekendSubmissions: number;
    reports: number;
    redemptions: number;
  };
  trendingContestants: {
    id: string;
    displayName: string;
    heatScore: number;
    heatTrend: string;
  }[];
  notifications: {
    pending: number;
    failed: number;
    deliveriesFailed: number;
  };
  rewards: {
    redemptionsToday: number;
    awaitingFulfilment: number;
    pointsSpentToday: number;
  };
  /** Sections this operator may open, so the sidebar is never a lie. */
  sections: string[];
}
