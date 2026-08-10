'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  changePasswordSchema,
  updateProfileSchema,
  type SessionSummary,
  type UpdateProfileInput,
} from '@reality/shared';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Textarea,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import {
  useAnalyticsPrivacy,
  useUpdateAnalyticsPrivacy,
} from '@/hooks/use-analytics';
import { useAuth } from '@/providers/auth-provider';

type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export function ProfileScreen() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingState rows={3} label="Loading your profile…" />;
  }

  if (!user) {
    return (
      <Alert tone="warning" title="You are signed out">
        Sign in again to see your profile.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your profile"
        description="Manage how you appear and keep your account secure."
      />

      {!user.emailVerified && (
        <Alert tone="warning" title="Confirm your email to take part">
          You can look around, but voting, predicting and submitting challenges stay locked until
          your address is confirmed.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileDetailsCard />
        <AccountSummaryCard />
        <ChangePasswordCard />
        <AnalyticsPrivacyCard />
        <SessionsCard />
      </div>
    </div>
  );
}

function ProfileDetailsCard() {
  const { user, refresh } = useAuth();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      bio: user?.bio ?? '',
      country: user?.country ?? '',
    },
  });

  async function onSubmit(values: UpdateProfileInput) {
    try {
      await api.patch('/users/me', values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      await refresh();
      toast.success('Profile updated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save your profile');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>Your display name is public; your email address is not.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField label="Display name" htmlFor="displayName" error={errors.displayName?.message}>
            <Input id="displayName" {...register('displayName')} />
          </FormField>

          <FormField label="Bio" htmlFor="bio" error={errors.bio?.message} hint="Up to 400 characters.">
            <Textarea id="bio" rows={4} {...register('bio')} />
          </FormField>

          <FormField label="Country" htmlFor="country" error={errors.country?.message}>
            <Input id="country" placeholder="IN" {...register('country')} />
          </FormField>

          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AccountSummaryCard() {
  const { user } = useAuth();
  if (!user) return null;

  const rows = [
    { label: 'Email', value: user.email },
    { label: 'Email confirmed', value: user.emailVerified ? 'Yes' : 'Not yet' },
    { label: 'Role', value: user.role },
    { label: 'Status', value: user.status.replace(/_/g, ' ').toLowerCase() },
    { label: 'Points', value: user.pointsBalance.toLocaleString() },
    { label: 'Lifetime points', value: user.lifetimePoints.toLocaleString() },
    { label: 'Member since', value: new Date(user.createdAt).toLocaleDateString() },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Points are for entertainment only — never bought, never paid out.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border/60 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-muted">{row.label}</dt>
              <dd className="font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ChangePasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordInput) {
    try {
      await api.post('/auth/change-password', values);
      reset();
      toast.success('Password changed. Every other session was signed out.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not change your password');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs out every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            label="Current password"
            htmlFor="currentPassword"
            error={errors.currentPassword?.message}
            required
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...register('currentPassword')}
            />
          </FormField>

          <FormField
            label="New password"
            htmlFor="newPassword"
            error={errors.newPassword?.message}
            required
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...register('newPassword')}
            />
          </FormField>

          <FormField
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={errors.confirmPassword?.message}
            required
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
          </FormField>

          <Button type="submit" loading={isSubmitting}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();

  const { data: sessions, isLoading } = useQuery({
    queryKey: queryKeys.auth.sessions,
    queryFn: () => api.get<SessionSummary[]>('/auth/sessions'),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
      toast.success('Session ended');
    },
    onError: () => toast.error('Could not end that session'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription>End any session you do not recognise.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div className="h-20 animate-pulse rounded-md bg-surface-raised" />}

        {sessions?.map((session) => (
          <div
            key={session.id}
            className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface-raised p-3"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm font-medium">
                {describeUserAgent(session.userAgent)}
                {session.current && (
                  <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                    This device
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                Last active {new Date(session.lastSeenAt).toLocaleString()}
              </p>
            </div>

            {!session.current && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revoke.mutate(session.id)}
                loading={revoke.isPending && revoke.variables === session.id}
              >
                End
              </Button>
            )}
          </div>
        ))}

        {sessions?.length === 0 && <p className="text-sm text-muted">No other active sessions.</p>}
      </CardContent>
    </Card>
  );
}

/**
 * The analytics opt-out.
 *
 * Placed with the account controls rather than buried in a policy page: a
 * setting somebody cannot find is not a choice they have.
 */
function AnalyticsPrivacyCard() {
  const privacy = useAnalyticsPrivacy();
  const update = useUpdateAnalyticsPrivacy();
  const optedOut = privacy.data?.optedOut ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Product analytics</CardTitle>
        <CardDescription>
          We count how the show is used — which features people reach for, how many take part —
          to decide what to build. Never what you wrote, never your contact details.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {optedOut
              ? 'You are not being measured. Nothing about you is recorded.'
              : 'Your activity is counted anonymously in platform totals.'}
          </p>
          <Button
            size="sm"
            variant={optedOut ? 'secondary' : 'ghost'}
            loading={update.isPending}
            disabled={privacy.isLoading}
            onClick={() => update.mutate(!optedOut)}
          >
            {optedOut ? 'Turn analytics on' : 'Turn analytics off'}
          </Button>
        </div>

        {!optedOut && (
          <p className="text-xs text-muted">
            Turning this off also deletes what has already been collected about you.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/mobile|android|iphone/i.test(userAgent)) return 'Mobile browser';
  if (/edg\//i.test(userAgent)) return 'Edge on desktop';
  if (/chrome/i.test(userAgent)) return 'Chrome on desktop';
  if (/safari/i.test(userAgent)) return 'Safari on desktop';
  if (/firefox/i.test(userAgent)) return 'Firefox on desktop';
  return 'Browser';
}
