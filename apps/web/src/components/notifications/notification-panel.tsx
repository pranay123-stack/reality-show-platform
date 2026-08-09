'use client';

import type { NotificationType, NotificationView } from '@reality/shared';
import { Button, EmptyState, Skeleton, cn } from '@reality/ui';
import {
  Bell,
  CalendarHeart,
  Gift,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Radio,
  Scale,
  Trophy,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { useMarkRead, useNotifications } from '@/hooks/use-notifications';

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  PREDICTION: ListChecks,
  POLL: Radio,
  CHALLENGE: MessagesSquare,
  PERSPECTIVE: Scale,
  ROUND: Users,
  KITCHEN: UtensilsCrossed,
  WEEKEND: CalendarHeart,
  REWARD: Gift,
  LEADERBOARD: Trophy,
  SYSTEM: Megaphone,
};

/** Compact enough for a dropdown; the full history lives on `/notifications`. */
const PANEL_LIMIT = 8;

export function NotificationPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isLoading } = useNotifications({ limit: PANEL_LIMIT });
  const markRead = useMarkRead();

  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <div className="flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">
          Notifications
          {unread > 0 && <span className="ml-2 text-xs font-normal text-muted">{unread} new</span>}
        </h2>
        {unread > 0 && (
          <Button
            size="sm"
            variant="ghost"
            loading={markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="You will hear about your predictions, challenges and rewards here."
            icon={<Bell className="h-5 w-5" aria-hidden />}
            className="py-8"
          />
        ) : (
          <ul className="space-y-1">
            {items.map((notification) => (
              <li key={notification.id}>
                <NotificationRow
                  notification={notification}
                  onOpen={() => {
                    if (!notification.read) markRead.mutate([notification.id]);
                    onNavigate?.();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Button asChild variant="ghost" className="w-full" onClick={onNavigate}>
          <Link href="/notifications">See all</Link>
        </Button>
      </div>
    </div>
  );
}

export function NotificationRow({
  notification,
  onOpen,
  showTime = true,
}: {
  notification: NotificationView;
  onOpen?: () => void;
  showTime?: boolean;
}) {
  const Icon = TYPE_ICON[notification.type] ?? Bell;

  const body = (
    <>
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          notification.read ? 'bg-surface-raised text-muted' : 'bg-primary/15 text-primary',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>

      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-start justify-between gap-2">
          <span
            className={cn('text-sm', notification.read ? 'text-muted' : 'font-medium text-foreground')}
          >
            {notification.title}
          </span>
          {/* An unread marker that does not depend on colour alone. */}
          {!notification.read && (
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
              aria-label="Unread"
            />
          )}
        </span>
        <span className="block text-xs text-muted">{notification.body}</span>
        {showTime && (
          <span className="block text-[11px] text-muted/80">
            {formatRelative(notification.createdAt)}
          </span>
        )}
      </span>
    </>
  );

  const className = cn(
    'flex w-full gap-3 rounded-lg px-2 py-2 text-left transition-colors',
    'hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );

  if (notification.link) {
    return (
      <Link href={notification.link} className={className} onClick={onOpen}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={onOpen}>
      {body}
    </button>
  );
}

/** "3 minutes ago" reads better than a timestamp for a feed this recent. */
export function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86_400],
    ['week', 604_800],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]!;
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit;
  }

  if (seconds >= 2_592_000) return new Date(iso).toLocaleDateString();
  return formatter.format(-Math.round(seconds / chosen[1]), chosen[0]);
}
