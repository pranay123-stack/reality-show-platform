import { Suspense } from 'react';

import { LoadingState } from '@reality/ui';
import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState rows={3} label="Loading the sign-in form…" />}>
      <LoginForm />
    </Suspense>
  );
}
