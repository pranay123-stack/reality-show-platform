import type { Metadata } from 'next';

import { RewardsPage } from '@/components/rewards/rewards-page';

export const metadata: Metadata = { title: 'Points & Rewards' };

export default function Page() {
  return <RewardsPage />;
}
