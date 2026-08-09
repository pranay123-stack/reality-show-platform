import type { Metadata } from 'next';

import { ChallengeDetail } from '@/components/challenges/challenge-detail';

export const metadata: Metadata = { title: 'Challenge' };

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChallengeDetail id={id} />;
}
