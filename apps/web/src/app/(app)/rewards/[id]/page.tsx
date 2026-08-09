import type { Metadata } from 'next';

import { RewardDetail } from '@/components/rewards/reward-detail';

export const metadata: Metadata = { title: 'Reward' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RewardDetail rewardId={id} />;
}
