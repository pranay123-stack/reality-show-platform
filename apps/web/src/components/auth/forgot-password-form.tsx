'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@reality/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@reality/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, api } from '@/lib/api-client';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    try {
      await api.post('/auth/forgot-password', values);
      setSent(true);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert tone="success" title="If an account exists for that address, a reset link is on its way.">
            The link works once and expires in 60 minutes.
          </Alert>
          <p className="text-sm text-muted">
            In development the email is printed to the API console instead of being delivered.
          </p>
          <Button asChild variant="secondary" fullWidth>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">Reset your password</CardTitle>
        <p className="text-sm text-muted">
          Enter your email address and we will send you a link to choose a new password.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
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

          <Button type="submit" fullWidth loading={isSubmitting}>
            Send reset link
          </Button>
        </form>

        <p className="text-center text-sm text-muted">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
