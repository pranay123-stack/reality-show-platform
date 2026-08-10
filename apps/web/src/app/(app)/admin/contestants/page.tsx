import type { Metadata } from 'next';

import { ContestantsSection } from '@/components/admin/contestants-section';

export const metadata: Metadata = { title: 'Contestants' };

export default function Page() {
  return <ContestantsSection />;
}
