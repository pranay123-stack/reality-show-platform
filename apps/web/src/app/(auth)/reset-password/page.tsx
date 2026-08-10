import { Suspense } from 'react';

import { LoadingState } from '@reality/ui';
import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingState rows={3} label="Loading the reset form…" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
