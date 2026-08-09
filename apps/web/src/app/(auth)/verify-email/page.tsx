import { Suspense } from 'react';
import type { Metadata } from 'next';

import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

export const metadata: Metadata = { title: 'Confirm your email' };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="surface-card h-72 animate-pulse" />}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
