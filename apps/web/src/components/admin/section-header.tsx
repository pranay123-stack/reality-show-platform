'use client';

import { PageHeader } from '@reality/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  // Every console page routes through here, which is what keeps the operator
  // side on one heading treatment rather than the two it had drifted into.
  return <PageHeader size="compact" title={title} description={description} action={action} />;
}

/**
 * An operator mutation.
 *
 * Every console action follows the same shape — call the endpoint that owns the
 * behaviour, report what happened, refetch the list — so it is worth having
 * once rather than thirty times. Note that this never posts to an admin-only
 * duplicate of a feature: the console drives the same endpoints the platform
 * already exposes, which is what keeps the permission check and the audit row
 * in exactly one place.
 */
export function useAdminMutation<Input>({
  key,
  fn,
  success,
  alsoInvalidate = [],
}: {
  key: readonly unknown[];
  fn: (input: Input) => Promise<unknown>;
  success: string | ((input: Input) => string);
  alsoInvalidate?: readonly (readonly unknown[])[];
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: async (_result, input) => {
      toast.success(typeof success === 'function' ? success(input) : success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        ...alsoInvalidate.map((extra) => queryClient.invalidateQueries({ queryKey: extra })),
      ]);
    },
    onError: (error: unknown) =>
      // The server's message is the useful one — it says *why* the action was
      // refused, which a generic string cannot.
      toast.error(error instanceof ApiError ? error.message : 'That action could not be completed'),
  });
}

/** Convenience for the common "POST to a lifecycle verb" shape. */
export function lifecycleCall(path: string, body: unknown = {}) {
  return api.post(path, body);
}
