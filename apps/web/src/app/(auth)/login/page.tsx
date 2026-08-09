import { Suspense } from 'react';
import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="surface-card h-96 animate-pulse" />}>
      <LoginForm />
    </Suspense>
  );
}
