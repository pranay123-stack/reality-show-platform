'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput } from '@reality/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@reality/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function SignupForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', displayName: '', acceptedTerms: false as never },
  });

  async function onSubmit(values: SignupInput) {
    setFormError(null);
    try {
      await api.post('/auth/signup', values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      router.push('/verify-email?sent=1');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        // Map server-side field errors back onto the form where possible.
        const fieldErrors = error.fieldErrors;
        let mapped = false;
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (field in values && messages[0]) {
            setError(field as keyof SignupInput, { message: messages[0] });
            mapped = true;
          }
        }
        if (error.code === 'EMAIL_TAKEN') {
          setError('email', { message: 'An account already exists for this email address' });
          mapped = true;
        }
        if (!mapped) setFormError(error.message);
        return;
      }
      setFormError('Something went wrong. Please try again.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Create your account</CardTitle>
        <p className="text-sm text-muted">
          One account per person — you will confirm your email before you can take part.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            label="Display name"
            htmlFor="displayName"
            error={errors.displayName?.message}
            hint="This is what other viewers see on the leaderboard."
            required
          >
            <Input
              id="displayName"
              autoComplete="nickname"
              placeholder="NightOwl"
              aria-invalid={Boolean(errors.displayName)}
              {...register('displayName')}
            />
          </FormField>

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

          <FormField
            label="Password"
            htmlFor="password"
            error={errors.password?.message}
            hint="At least 10 characters. Length matters more than symbols."
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

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border bg-input accent-[hsl(var(--primary))]"
                aria-invalid={Boolean(errors.acceptedTerms)}
                {...register('acceptedTerms')}
              />
              <span>
                I agree to the terms of use and understand that points are for entertainment only —
                they are never purchased and never paid out.
              </span>
            </label>
            {errors.acceptedTerms && (
              <p className="text-xs text-danger" role="alert">
                {errors.acceptedTerms.message}
              </p>
            )}
          </div>

          <Button type="submit" fullWidth loading={isSubmitting}>
            Create account
          </Button>
        </form>

        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
