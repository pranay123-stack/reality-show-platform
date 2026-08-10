'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@reality/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@reality/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const redirectTo = safeRedirect(searchParams.get('next'));
  const justVerified = searchParams.get('verified') === '1';
  const justReset = searchParams.get('reset') === '1';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      await api.post('/auth/login', values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      router.push(redirectTo);
      router.refresh();
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">Welcome back</CardTitle>
        <p className="text-sm text-muted">Sign in to keep playing along with the show.</p>
      </CardHeader>

      <CardContent className="space-y-5">
        {justVerified && (
          <Alert tone="success" title="Email confirmed">
            You can sign in now.
          </Alert>
        )}
        {justReset && (
          <Alert tone="success" title="Password updated">
            Sign in with your new password.
          </Alert>
        )}
        {formError && <Alert tone="danger">{formError}</Alert>}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField label="Email" htmlFor="email" error={errors.email?.message} required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </FormField>

          <FormField label="Password" htmlFor="password" error={errors.password?.message} required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
          </FormField>

          <div className="flex items-center justify-between gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border bg-input accent-[hsl(var(--primary))]"
                {...register('rememberMe')}
              />
              Keep me signed in
            </label>

            <Link
              href="/forgot-password"
              className="inline-flex min-h-6 items-center text-sm text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <Button type="submit" fullWidth loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-muted">
          New here?{' '}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Only same-site relative paths are accepted, so `?next=https://evil.example`
 * cannot turn the sign-in page into an open redirect.
 */
function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}
