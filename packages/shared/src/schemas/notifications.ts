import { z } from 'zod';

import { idSchema } from './common';

/**
 * Notifications.
 *
 * The organising idea is that features emit **events**, not notifications. A
 * prediction module knows a prediction was resolved; it does not know that
 * anybody wants to be told, how it should be worded, or through which channel.
 * That knowledge lives here and in the notification module, which is what keeps
 * a copy change from touching the prediction service.
 *
 * Three levels, deliberately distinct:
 *
 *  - **Event** (`prediction.resolved`) — what happened. Fine-grained. Keys the
 *    template and the deduplication.
 *  - **Type** (`PREDICTION`) — the preference bucket. Coarse, because people
 *    want to mute a feature, not tune fifteen switches.
 *  - **Channel** (`IN_APP`) — how it is delivered.
 */

export const NOTIFICATION_TYPES = [
  'PREDICTION',
  'POLL',
  'CHALLENGE',
  'PERSPECTIVE',
  'ROUND',
  'KITCHEN',
  'WEEKEND',
  'REWARD',
  'LEADERBOARD',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// ---------------------------------------------------------------------------
// The event catalogue
// ---------------------------------------------------------------------------

/**
 * Every event the platform can notify about.
 *
 * A feature emits one of these keys with a payload; everything downstream —
 * which bucket it belongs to, how it is worded, whether it is urgent enough to
 * bypass a digest — is decided from this table and the template rows.
 */
export const NOTIFICATION_EVENTS = {
  'prediction.opened': { type: 'PREDICTION', audience: 'broadcast' },
  'prediction.closing': { type: 'PREDICTION', audience: 'participants' },
  'prediction.resolved': { type: 'PREDICTION', audience: 'participants' },

  'challenge.approved': { type: 'CHALLENGE', audience: 'author' },
  'challenge.rejected': { type: 'CHALLENGE', audience: 'author' },
  'challenge.trending': { type: 'CHALLENGE', audience: 'author' },
  'challenge.selected': { type: 'CHALLENGE', audience: 'author' },

  'reward.redemption_created': { type: 'REWARD', audience: 'actor' },
  'reward.redemption_approved': { type: 'REWARD', audience: 'actor' },
  'reward.redemption_fulfilled': { type: 'REWARD', audience: 'actor' },
  'reward.redemption_cancelled': { type: 'REWARD', audience: 'actor' },

  'leaderboard.rank_up': { type: 'LEADERBOARD', audience: 'actor' },
  'leaderboard.rank_down': { type: 'LEADERBOARD', audience: 'actor' },
  'leaderboard.milestone': { type: 'LEADERBOARD', audience: 'actor' },

  'weekend.round_opened': { type: 'WEEKEND', audience: 'broadcast' },
  'weekend.submission_selected': { type: 'WEEKEND', audience: 'actor' },
  'weekend.submission_rejected': { type: 'WEEKEND', audience: 'actor' },

  'kitchen.decision_opened': { type: 'KITCHEN', audience: 'broadcast' },
  'kitchen.result_published': { type: 'KITCHEN', audience: 'participants' },

  'system.announcement': { type: 'SYSTEM', audience: 'broadcast' },
} as const satisfies Record<string, { type: NotificationType; audience: EventAudience }>;

export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;

/**
 * Who an event reaches.
 *
 * `broadcast` is the expensive one and is used sparingly — only for things
 * genuinely addressed to everybody, like a round opening.
 */
export type EventAudience = 'broadcast' | 'participants' | 'author' | 'actor';

export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[];

export function typeForEvent(event: NotificationEventKey): NotificationType {
  return NOTIFICATION_EVENTS[event].type;
}

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  PREDICTION: 'Prediction game',
  POLL: 'Live polls',
  CHALLENGE: 'Your challenges',
  PERSPECTIVE: 'Audience perspective',
  ROUND: 'Nominations & evictions',
  KITCHEN: 'Kitchen control',
  WEEKEND: 'Weekend participation',
  REWARD: 'Rewards',
  LEADERBOARD: 'Leaderboard',
  SYSTEM: 'Announcements',
};

export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> = {
  PREDICTION: 'When predictions open, are about to close, and are resolved.',
  POLL: 'When a live poll starts or its result is published.',
  CHALLENGE: 'What happens to challenges you submitted.',
  PERSPECTIVE: 'When an audience perspective opens on an event you watched.',
  ROUND: 'When a nomination or eviction round opens.',
  KITCHEN: 'Kitchen decisions you can vote on, and their results.',
  WEEKEND: 'Weekend rounds opening, and what happens to your entry.',
  REWARD: 'Progress on rewards you have redeemed.',
  LEADERBOARD: 'Big moves in your ranking, and milestones you pass.',
  SYSTEM: 'Occasional announcements from the production team.',
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Cursor is the id of the last row seen — notifications are a feed. */
  cursor: idSchema.optional(),
});

export const markReadSchema = z.object({
  /** Omit to mark everything read. */
  ids: z.array(idSchema).min(1).max(200).optional(),
});

export const updatePreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  push: z.boolean().optional(),
});

export const updatePreferencesSchema = z.object({
  preferences: z.array(updatePreferenceSchema).min(1).max(NOTIFICATION_TYPES.length),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

/**
 * An administrator's announcement.
 *
 * The only route in the system that creates a notification from a request body,
 * which is why it is permission-gated, audited, and cannot set a recipient list
 * — it goes to everyone who has not muted announcements.
 */
export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(500),
  link: z.string().trim().max(200).optional(),
});

export const retryDeliverySchema = z.object({
  /** Omit to retry every failed delivery. */
  deliveryIds: z.array(idSchema).min(1).max(500).optional(),
});

export const notificationHealthQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface NotificationView {
  id: string;
  type: NotificationType;
  event: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeedView {
  items: NotificationView[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationPreferenceView {
  type: NotificationType;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

export interface DeliveryHealthView {
  channel: NotificationChannel;
  /** Whether a provider is actually wired up for this channel. */
  available: boolean;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface NotificationHealthView {
  windowHours: number;
  events: { pending: number; processed: number; failed: number };
  notifications: { created: number; read: number };
  channels: DeliveryHealthView[];
  recentFailures: {
    id: string;
    channel: NotificationChannel;
    attemptCount: number;
    lastError: string | null;
    notificationId: string;
    event: string;
    createdAt: string;
  }[];
  stuckEvents: {
    id: string;
    event: string;
    entityId: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }[];
}
