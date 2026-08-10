import type { Metadata } from 'next';

import { ContestantsScreen } from '@/components/contestants/contestants-screen';

export const metadata: Metadata = { title: 'House Heat' };

export default function ContestantsPage() {
  return <ContestantsScreen />;
}
