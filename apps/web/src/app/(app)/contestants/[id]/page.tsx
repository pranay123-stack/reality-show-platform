import type { Metadata } from 'next';

import { ContestantDetail } from '@/components/contestants/contestant-detail';

export const metadata: Metadata = { title: 'Contestant' };

export default async function ContestantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContestantDetail id={id} />;
}
