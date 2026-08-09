'use client';

import type { AuthUser, Role } from '@reality/shared';
import { roleAtLeast } from '@reality/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True only once the address is confirmed — required to take part. */
  canParticipate: boolean;
  hasRole: (role: Role) => boolean;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => api.get<AuthUser>('/auth/me'),
    // 401 is the normal answer for a signed-out visitor, not an error worth retrying.
    retry: false,
    staleTime: 60_000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack types the error as unknown
    throwOnError: false as any,
  });

  const user = data ?? null;

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      queryClient.setQueryData(queryKeys.auth.me, null);
      queryClient.clear();
      router.push('/login');
      router.refresh();
    },
  });

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync().catch((error: unknown) => {
      // Already signed out server-side is a fine outcome for a logout button.
      if (!(error instanceof ApiError)) throw error;
    });
  }, [logoutMutation]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      canParticipate: user?.emailVerified === true && user.status === 'ACTIVE',
      hasRole: (role) => (user ? roleAtLeast(user.role, role) : false),
      can: (permission) => user?.permissions.includes(permission) ?? false,
      logout,
      refresh,
    }),
    [user, isLoading, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
