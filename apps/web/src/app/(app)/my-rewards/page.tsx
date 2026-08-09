import type { Metadata } from 'next';

import { MyRewardsPage } from '@/components/rewards/my-rewards-page';

export const metadata: Metadata = { title: 'My rewards' };

export default function Page() {
  return <MyRewardsPage />;
}
