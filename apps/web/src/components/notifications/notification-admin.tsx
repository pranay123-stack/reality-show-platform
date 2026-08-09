'use client';

import type { NotificationHealthView } from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Textarea,
  cn,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Megaphone, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { formatRelative } from '@/components/notifications/notification-panel';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/**
 * Notification operations.
 *
 * The point of this screen is that a silent failure is impossible to notice: an
 * email that never sent leaves no trace in the user's feed, so the only way an
 * operator learns about it is a page like this.
 */
export function NotificationAdmin() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24);

  const health = useQuery({
    queryKey: queryKeys.admin.section('notifications', hours),
    queryFn: () => api.get<NotificationHealthView>(`/notifications/admin/health?hours=${hours}`),
    refetchInterval: 60_000,
  });

  const retry = useMutation({
    mutationFn: (deliveryIds?: string[]) =>
      api.post<{ deliveries: number; events: number }>('/notifications/admin/retry', {
        deliveryIds,
      }),
    onSuccess: async (result) => {
      toast.success(
        result.deliveries === 0 && result.events === 0
          ? 'Nothing was waiting'
          : `Retried ${result.deliveries} deliveries and ${result.events} events`,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.admin.section('notifications', hours),
      });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not retry those deliveries'),
  });

  if (!can('notification.inspect')) {
    return (
      <Alert tone="danger" title="Not available">
        You do not have access to notification operations.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-display-md font-semibold">Notification health</h1>
          <p className="text-muted">
            Events recorded, notifications produced, and anything that failed on the way out.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[1, 24, 168].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={hours === option}
              onClick={() => setHours(option)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                hours === option
                  ? 'border-primary/50 bg-primary/15 text-foreground'
                  : 'border-border text-muted hover:border-border-strong hover:text-foreground',
              )}
            >
              {option === 1 ? 'Last hour' : option === 24 ? 'Last day' : 'Last week'}
            </button>
          ))}
        </div>
      </header>

      {health.isError ? (
        <ErrorState onRetry={() => void health.refetch()} />
      ) : health.isLoading || !health.data ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Events processed" value={health.data.events.processed} />
            <Stat
              label="Events awaiting"
              value={health.data.events.pending + health.data.events.failed}
              tone={health.data.events.failed > 0 ? 'danger' : undefined}
            />
            <Stat label="Notifications created" value={health.data.notifications.created} />
            <Stat label="Read by users" value={health.data.notifications.read} />
          </div>

          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-medium">Channels</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-medium">Channel</th>
                    <th className="py-2 pr-3 font-medium">Provider</th>
                    <th className="py-2 pr-3 text-right font-medium">Sent</th>
                    <th className="py-2 pr-3 text-right font-medium">Failed</th>
                    <th className="py-2 text-right font-medium">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {health.data.channels.map((channel) => (
                    <tr key={channel.channel} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3 font-medium">{channel.channel}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={channel.available ? 'success' : 'neutral'} size="sm">
                          {channel.available ? 'configured' : 'not configured'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{channel.sent}</td>
                      <td
                        className={cn(
                          'py-2 pr-3 text-right tabular-nums',
                          channel.failed > 0 && 'text-danger',
                        )}
                      >
                        {channel.failed}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted">{channel.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              “Skipped” is not a failure — it is a channel with no provider configured, or a
              recipient who muted that feature.
            </p>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">Failures</h2>
              {can('notification.manage') && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={retry.isPending}
                  onClick={() => retry.mutate(undefined)}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Retry everything failed
                </Button>
              )}
            </div>

            {health.data.recentFailures.length === 0 && health.data.stuckEvents.length === 0 ? (
              <EmptyState
                title="Nothing failed"
                description="Every event was fanned out and every delivery was accepted."
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
                className="py-6"
              />
            ) : (
              <ul className="space-y-2">
                {health.data.recentFailures.map((failure) => (
                  <li
                    key={failure.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">
                        {failure.event}{' '}
                        <Badge tone="neutral" size="sm">
                          {failure.channel}
                        </Badge>
                      </p>
                      <p className="truncate text-xs text-muted">
                        {failure.lastError ?? 'No error recorded'}
                      </p>
                      <p className="text-[11px] text-muted/80">
                        attempt {failure.attemptCount} · {formatRelative(failure.createdAt)}
                      </p>
                    </div>
                    {can('notification.manage') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={retry.isPending}
                        onClick={() => retry.mutate([failure.id])}
                      >
                        Resend
                      </Button>
                    )}
                  </li>
                ))}

                {health.data.stuckEvents.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2"
                  >
                    <p className="text-sm font-medium">
                      {event.event}{' '}
                      <Badge tone="warning" size="sm">
                        not fanned out
                      </Badge>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {event.lastError ?? 'Waiting to be processed'} · {event.attempts} attempts
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {can('notification.announce') && <Announcer />}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger';
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'danger' && value > 0 && 'text-danger',
        )}
      >
        {value.toLocaleString()}
      </p>
    </Card>
  );
}

/** The only place a human writes a notification. Deliberately a little heavy. */
function Announcer() {
  const [form, setForm] = useState({ title: '', body: '', link: '' });

  const announce = useMutation({
    mutationFn: () =>
      api.post('/notifications/admin/announce', {
        title: form.title.trim(),
        body: form.body.trim(),
        ...(form.link.trim() ? { link: form.link.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Announcement queued for everyone who has not muted announcements');
      setForm({ title: '', body: '', link: '' });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send that announcement'),
  });

  const ready = form.title.trim().length >= 3 && form.body.trim().length >= 3;

  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Megaphone className="h-4 w-4 text-primary" aria-hidden />
          Announcement
        </h2>
        <p className="text-xs text-muted">
          Goes to every verified, active account that has not muted announcements. It cannot be
          unsent.
        </p>
      </div>

      <FormField label="Title" htmlFor="announce-title">
        <Input
          id="announce-title"
          value={form.title}
          maxLength={120}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Live show tonight"
        />
      </FormField>

      <FormField label="Message" htmlFor="announce-body">
        <Textarea
          id="announce-body"
          rows={3}
          maxLength={500}
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          placeholder="Doors at eight. Voting opens straight after the opening titles."
        />
      </FormField>

      <FormField label="Link" htmlFor="announce-link" hint="Optional. A path such as /polls.">
        <Input
          id="announce-link"
          value={form.link}
          onChange={(event) => setForm({ ...form, link: event.target.value })}
          placeholder="/polls"
        />
      </FormField>

      <Button disabled={!ready} loading={announce.isPending} onClick={() => announce.mutate()}>
        Send to everyone
      </Button>
    </Card>
  );
}
