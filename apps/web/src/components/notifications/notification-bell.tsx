'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@reality/ui';
import { Bell } from 'lucide-react';
import { useState } from 'react';

import { NotificationPanel } from '@/components/notifications/notification-panel';
import { useUnreadCount } from '@/hooks/use-notifications';
import { useAuth } from '@/providers/auth-provider';

/**
 * The bell.
 *
 * The badge is capped at 9+ because the exact number stops being useful past a
 * handful, and an unbounded count makes the button jump around as it grows.
 */
export function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const { data } = useUnreadCount(isAuthenticated);

  const count = data?.count ?? 0;
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="relative">
          <Bell className="h-5 w-5" aria-hidden />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="p-0">
        <NotificationPanel onNavigate={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
