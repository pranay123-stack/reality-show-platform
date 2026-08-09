import { Suspense } from 'react';
import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="surface-card h-96 animate-pulse" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
