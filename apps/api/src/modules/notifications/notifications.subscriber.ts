import { onDomainEvent } from '../../core/domain-events.js';
import { processEvent } from './notifications.service.js';

/**
 * The one place notifications are wired to the event bus.
 *
 * This is the join between the two halves of the system, and it points in only
 * one direction: the notification module knows about domain events, and no
 * feature module knows notifications exist. Deleting this file would stop every
 * notification in the platform without breaking a single feature — which is the
 * test of whether the decoupling is real.
 */
export function registerNotificationSubscriber(): void {
  onDomainEvent(async ({ id }) => {
    await processEvent(id);
  });
}
