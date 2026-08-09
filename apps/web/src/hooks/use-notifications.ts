'use client';

import type {
  NotificationFeedView,
  NotificationPreferenceView,
  NotificationType,
} from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Notification data.
 *
 * The unread count is polled on its own rather than derived from the feed: the
 * bell is on every screen while the feed is only open occasionally, and a count
 * is a far cheaper thing to ask for repeatedly than a page of rows.
 */

const UNREAD_POLL_MS = 60_000;

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications.unread,
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    enabled,
    staleTime: 30_000,
    refetchInterval: UNREAD_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(options: { unreadOnly?: boolean; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (options.unreadOnly) params.set('unreadOnly', 'true');
  if (options.limit) params.set('limit', String(options.limit));

  return useQuery({
    queryKey: [...queryKeys.notifications.list, options],
    queryFn: () => api.get<NotificationFeedView>(`/notifications?${params.toString()}`),
    staleTime: 15_000,
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notifications.preferences,
    queryFn: () => api.get<NotificationPreferenceView[]>('/notifications/preferences'),
    staleTime: 120_000,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    /** Omitting ids marks everything read. */
    mutationFn: (ids?: string[]) =>
      api.post<{ updated: number; unreadCount: number }>('/notifications/read', { ids }),
    onSuccess: async (result, ids) => {
      // Only announce the bulk action; marking one read by opening it should be
      // silent, because the row visibly changes anyway.
      if (!ids && result.updated > 0) toast.success('All caught up');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unread }),
      ]);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update your notifications'),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      preferences: { type: NotificationType; inApp?: boolean; email?: boolean; push?: boolean }[],
    ) => api.patch<NotificationPreferenceView[]>('/notifications/preferences', { preferences }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.notifications.preferences, updated);
      toast.success('Preferences saved');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save that preference'),
  });
}
