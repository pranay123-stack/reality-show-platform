import type { NotificationEventKey, NotificationType } from '@reality/shared';
import { typeForEvent } from '@reality/shared';

/**
 * Wording.
 *
 * Templates live in the database so copy can change without a deploy, but the
 * built-in table below is the fallback. That ordering matters: a missing or
 * mistyped template row must never stop a user being told something, so an
 * absent row degrades to the default rather than throwing.
 *
 * Placeholders are `{{name}}` and are filled from the event payload. An unknown
 * placeholder renders as empty rather than as literal braces — a stray `{{foo}}`
 * on screen is worse than a slightly terse sentence.
 */

export interface TemplateDefinition {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

export const DEFAULT_TEMPLATES: Record<NotificationEventKey, TemplateDefinition> = {
  'prediction.opened': {
    type: 'PREDICTION',
    title: 'New prediction open',
    body: '{{question}} — get your call in before it closes.',
    link: '/predictions',
  },
  'prediction.closing': {
    type: 'PREDICTION',
    title: 'Closing soon',
    body: '{{question}} closes shortly. Last chance to change your mind.',
    link: '/predictions',
  },
  'prediction.resolved': {
    type: 'PREDICTION',
    title: 'Prediction resolved',
    body: '{{question}} — the answer was {{answer}}.',
    link: '/predictions',
  },

  'challenge.approved': {
    type: 'CHALLENGE',
    title: 'Your challenge was approved',
    body: '“{{title}}” passed moderation and is now open to community voting.',
    link: '/challenges/{{entityId}}',
  },
  'challenge.rejected': {
    type: 'CHALLENGE',
    title: 'Your challenge was not approved',
    body: '“{{title}}” was not accepted. {{reason}}',
    link: '/challenges',
  },
  'challenge.trending': {
    type: 'CHALLENGE',
    title: 'Your challenge is trending',
    body: '“{{title}}” has reached {{votes}} votes.',
    link: '/challenges/{{entityId}}',
  },
  'challenge.selected': {
    type: 'CHALLENGE',
    title: 'Your challenge was selected',
    body: 'Production picked “{{title}}” to run in the house.',
    link: '/challenges/{{entityId}}',
  },

  'reward.redemption_created': {
    type: 'REWARD',
    title: 'Redemption requested',
    body: '{{rewardName}} — {{points}} points held while production confirms it.',
    link: '/my-rewards',
  },
  'reward.redemption_approved': {
    type: 'REWARD',
    title: 'Redemption approved',
    body: '{{rewardName}} has been approved and is being arranged.',
    link: '/my-rewards',
  },
  'reward.redemption_fulfilled': {
    type: 'REWARD',
    title: '{{rewardName}} is yours',
    body: 'Your redemption has been fulfilled.',
    link: '/my-rewards',
  },
  'reward.redemption_cancelled': {
    type: 'REWARD',
    title: 'Redemption cancelled',
    body: '{{rewardName}} was cancelled and {{points}} points were returned.',
    link: '/my-rewards',
  },

  'leaderboard.rank_up': {
    type: 'LEADERBOARD',
    title: 'You climbed to #{{rank}}',
    body: 'Up {{places}} on the {{window}} board.',
    link: '/leaderboard',
  },
  'leaderboard.rank_down': {
    type: 'LEADERBOARD',
    title: 'You slipped to #{{rank}}',
    body: 'Down {{places}} on the {{window}} board.',
    link: '/leaderboard',
  },
  'leaderboard.milestone': {
    type: 'LEADERBOARD',
    title: '{{milestone}} points',
    body: 'You have passed {{milestone}} points earned this season.',
    link: '/leaderboard',
  },

  'weekend.round_opened': {
    type: 'WEEKEND',
    title: 'Weekend round open',
    body: '{{title}} — entries are open now.',
    link: '/weekend',
  },
  'weekend.submission_selected': {
    type: 'WEEKEND',
    title: 'Your weekend entry was selected',
    body: 'Production picked your entry for {{title}}.',
    link: '/weekend',
  },
  'weekend.submission_rejected': {
    type: 'WEEKEND',
    title: 'Your weekend entry was not accepted',
    body: '{{reason}}',
    link: '/weekend',
  },

  'kitchen.decision_opened': {
    type: 'KITCHEN',
    title: 'Kitchen vote open',
    body: '{{title}} — the house needs your call.',
    link: '/kitchen',
  },
  'kitchen.result_published': {
    type: 'KITCHEN',
    title: 'Kitchen result',
    body: '{{title}} — the audience chose {{winner}}.',
    link: '/kitchen',
  },

  'system.announcement': {
    type: 'SYSTEM',
    title: '{{title}}',
    body: '{{body}}',
  },
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function render(template: string, values: Record<string, unknown>): string {
  return template
    .replace(PLACEHOLDER, (_match, key: string) => {
      const value = values[key];
      if (value === undefined || value === null) return '';
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    })
    // A missing placeholder can leave a double space or a dangling separator.
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function defaultTemplateFor(event: string): TemplateDefinition {
  const known = DEFAULT_TEMPLATES[event as NotificationEventKey];
  if (known) return known;

  // An event with no template at all still reaches the user, just plainly.
  return {
    type: (isKnownEvent(event) ? typeForEvent(event) : 'SYSTEM') as NotificationType,
    title: 'Update',
    body: 'Something happened on your account.',
  };
}

function isKnownEvent(event: string): event is NotificationEventKey {
  return event in DEFAULT_TEMPLATES;
}
