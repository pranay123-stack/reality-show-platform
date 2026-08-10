'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput } from '@reality/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@reality/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, api } from '@/lib/api-client';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', values);
      router.push('/login?reset=1');
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">Link not valid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert tone="danger" title="This reset link is missing its token.">
            Reset links can only be used once and expire after 60 minutes.
          </Alert>
          <Button asChild fullWidth>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">Choose a new password</CardTitle>
        <p className="text-sm text-muted">
          Setting a new password signs you out everywhere else.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <input type="hidden" {...register('token')} />

          <FormField
            label="New password"
            htmlFor="password"
            error={errors.password?.message}
            hint="At least 10 characters."
            required
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
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
              aria-invalid={Boolean(errors.confirmPassword)}
              {...register('confirmPassword')}
            />
          </FormField>

          <Button type="submit" fullWidth loading={isSubmitting}>
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
