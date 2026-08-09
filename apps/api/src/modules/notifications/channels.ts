import type { NotificationChannel } from '@reality/shared';

import { getConfig } from '../../core/config.js';

/**
 * Delivery channels.
 *
 * One interface, three implementations at different stages of completeness.
 * `IN_APP` is real. `EMAIL` and `PUSH` are deliberately *declared* rather than
 * faked: a provider that silently pretends to send is worse than one that
 * reports itself unavailable, because the first produces a green dashboard while
 * nobody receives anything.
 *
 * An unavailable channel marks its delivery `SKIPPED`, not `FAILED` — nothing is
 * broken, the platform simply has no SMTP credentials yet. Keeping those apart
 * is what stops the admin failure queue filling with noise that no retry can fix.
 */

export interface DeliveryPayload {
  userId: string;
  email: string | null;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
}

export type DeliveryOutcome =
  | { status: 'SENT' }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

export interface ChannelProvider {
  readonly channel: NotificationChannel;
  /** False when the channel has no working configuration. */
  isAvailable(): boolean;
  send(payload: DeliveryPayload): Promise<DeliveryOutcome>;
}

/**
 * In-app delivery.
 *
 * The `Notification` row *is* the delivery — writing it is what puts the item in
 * the user's feed. This provider therefore only confirms, which is why it can
 * never fail: if the row exists, the user can see it.
 */
const inAppProvider: ChannelProvider = {
  channel: 'IN_APP',
  isAvailable: () => true,
  async send() {
    return { status: 'SENT' };
  },
};

const emailProvider: ChannelProvider = {
  channel: 'EMAIL',
  isAvailable() {
    const config = getConfig();
    return Boolean(config.SMTP_HOST && config.SMTP_PORT);
  },
  async send(payload) {
    if (!this.isAvailable()) {
      return { status: 'SKIPPED', reason: 'No SMTP transport is configured' };
    }
    if (!payload.email) {
      return { status: 'SKIPPED', reason: 'That account has no email address' };
    }
    // The transport lands here. Until then this reports honestly rather than
    // claiming a send that did not happen.
    return { status: 'SKIPPED', reason: 'Email transport not implemented yet' };
  },
};

const pushProvider: ChannelProvider = {
  channel: 'PUSH',
  isAvailable: () => false,
  async send() {
    return { status: 'SKIPPED', reason: 'No push provider is configured' };
  },
};

const providers: Record<NotificationChannel, ChannelProvider> = {
  IN_APP: inAppProvider,
  EMAIL: emailProvider,
  PUSH: pushProvider,
};

export function providerFor(channel: NotificationChannel): ChannelProvider {
  return providers[channel];
}

export function availableChannels(): NotificationChannel[] {
  return (Object.keys(providers) as NotificationChannel[]).filter((channel) =>
    providers[channel].isAvailable(),
  );
}

/**
 * Test seam.
 *
 * Retry behaviour is only worth having if it is proven, and proving it needs a
 * channel that fails on demand. Restricted to tests so a swapped provider can
 * never linger in a running server.
 */
export function __setProviderForTests(
  channel: NotificationChannel,
  provider: ChannelProvider | null,
): void {
  if (!getConfig().isTest) throw new Error('Providers may only be replaced in tests');
  providers[channel] = provider ?? defaults[channel];
}

const defaults: Record<NotificationChannel, ChannelProvider> = {
  IN_APP: inAppProvider,
  EMAIL: emailProvider,
  PUSH: pushProvider,
};
