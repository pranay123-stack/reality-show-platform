'use client';

import type { NotificationPreferenceView } from '@reality/shared';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@reality/ui';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';

import { NotificationRow } from '@/components/notifications/notification-panel';
import {
  useMarkRead,
  useNotificationPreferences,
  useNotifications,
  useUpdateNotificationPreferences,
} from '@/hooks/use-notifications';

export function NotificationPage() {
  const [tab, setTab] = useState<'inbox' | 'settings'>('inbox');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted">
            What happened while you were away, and what you want to hear about.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {tab === 'inbox' ? <Inbox /> : <PreferenceSettings />}
    </div>
  );
}

function Inbox() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading, isError, refetch } = useNotifications({ unreadOnly, limit: 50 });
  const markRead = useMarkRead();

  if (isLoading) return <LoadingState rows={5} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {[
            { key: false, label: 'All' },
            { key: true, label: `Unread${unread > 0 ? ` (${unread})` : ''}` },
          ].map((option) => (
            <button
              key={String(option.key)}
              type="button"
              aria-pressed={unreadOnly === option.key}
              onClick={() => setUnreadOnly(option.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                unreadOnly === option.key
                  ? 'border-primary/50 bg-primary/15 text-foreground'
                  : 'border-border text-muted hover:border-border-strong hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {unread > 0 && (
          <Button
            variant="secondary"
            size="sm"
            loading={markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
            Mark all read
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Nothing unread' : 'Nothing yet'}
          description="Take part in a prediction, a challenge or a kitchen vote and you will hear back here."
          icon={<Bell className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <Card className="p-2">
          <ul className="divide-y divide-border/60">
            {items.map((notification) => (
              <li key={notification.id} className="py-0.5">
                <NotificationRow
                  notification={notification}
                  onOpen={() => {
                    if (!notification.read) markRead.mutate([notification.id]);
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function PreferenceSettings() {
  const { data, isLoading, isError, refetch } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  if (isLoading) return <LoadingState rows={5} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const preferences = data ?? [];

  return (
    <div className="space-y-4">
      <Alert tone="info">
        Turning a feature off means those notifications are never created — not hidden. Email and
        push are listed so you can opt in now; the platform sends in-app only for the moment.
      </Alert>

      <Card className="overflow-hidden p-0">
        {/* Scrolls independently so three channel columns never push the page wide. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Notify me about</th>
                <th className="px-3 py-3 text-center font-medium">In app</th>
                <th className="px-3 py-3 text-center font-medium">Email</th>
                <th className="px-3 py-3 text-center font-medium">Push</th>
              </tr>
            </thead>
            <tbody>
              {preferences.map((preference) => (
                <PreferenceRow
                  key={preference.type}
                  preference={preference}
                  pending={update.isPending}
                  onToggle={(channel, value) =>
                    update.mutate([{ type: preference.type, [channel]: value }])
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PreferenceRow({
  preference,
  pending,
  onToggle,
}: {
  preference: NotificationPreferenceView;
  pending: boolean;
  onToggle: (channel: 'inApp' | 'email' | 'push', value: boolean) => void;
}) {
  const channels = [
    { key: 'inApp' as const, value: preference.inApp, label: 'in app' },
    { key: 'email' as const, value: preference.email, label: 'email' },
    { key: 'push' as const, value: preference.push, label: 'push' },
  ];

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium">{preference.label}</p>
        <p className="text-xs text-muted">{preference.description}</p>
      </td>

      {channels.map((channel) => (
        <td key={channel.key} className="px-3 py-3 text-center">
          <label className="inline-flex cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              checked={channel.value}
              disabled={pending}
              onChange={(event) => onToggle(channel.key, event.target.checked)}
              aria-label={`${preference.label} — ${channel.label}`}
            />
          </label>
        </td>
      ))}
    </tr>
  );
}
