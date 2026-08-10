import { Suspense } from 'react';

import { LoadingState } from '@reality/ui';
import type { Metadata } from 'next';

import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

export const metadata: Metadata = { title: 'Confirm your email' };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingState rows={2} label="Loading…" />}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
