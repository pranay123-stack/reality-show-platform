'use client';

import type { ClientReportableEvent } from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';

/**
 * Client-side view reporting.
 *
 * Only the events a server cannot observe: what somebody looked at. Anything
 * with a consequence is recorded from the action itself, so this cannot inflate
 * a number that matters.
 *
 * Events are batched and flushed on a short timer, so a page rendering ten
 * cards is one request rather than ten. A failed flush is dropped silently —
 * losing an observation is not worth a toast, let alone a retry storm.
 */

interface QueuedEvent {
  name: ClientReportableEvent;
  entityId?: string;
  properties?: Record<string, string | number | boolean>;
}

const FLUSH_DELAY_MS = 1500;
const MAX_BATCH = 20;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);

  void api.post('/analytics/events', { events: batch }).catch(() => {
    // Deliberately silent. Analytics is observation; a viewer must never learn
    // that it failed, and retrying would turn a blip into a storm.
  });

  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_DELAY_MS);
}

export function trackView(event: QueuedEvent): void {
  if (typeof window === 'undefined') return;
  queue.push(event);
  schedule();
}

/**
 * Reports a view once per mount.
 *
 * The ref guard matters in React strict mode, where effects run twice in
 * development — without it every view would be reported twice locally and once
 * in production, which is the worst kind of measurement bug.
 */
export function useTrackView(
  name: ClientReportableEvent,
  entityId?: string,
  enabled = true,
): void {
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const key = `${name}:${entityId ?? '-'}`;
    if (reported.current === key) return;
    reported.current = key;
    trackView({ name, entityId });
  }, [name, entityId, enabled]);
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

export function useAnalyticsPrivacy() {
  return useQuery({
    queryKey: ['analytics', 'privacy'] as const,
    queryFn: () => api.get<{ optedOut: boolean }>('/analytics/me/privacy'),
    staleTime: 300_000,
  });
}

export function useUpdateAnalyticsPrivacy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (optOut: boolean) =>
      api.patch<{ optedOut: boolean }>('/analytics/me/privacy', { optOut }),
    onSuccess: async (result) => {
      toast.success(
        result.optedOut
          ? 'Analytics off — what was collected has been deleted'
          : 'Analytics on',
      );
      await queryClient.invalidateQueries({
        queryKey: ['analytics', 'privacy'] as const,
      });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change that setting'),
  });
}
