import type { Metadata } from 'next';

import { RewardAdminDashboard } from '@/components/rewards/reward-admin-dashboard';

export const metadata: Metadata = { title: 'Reward administration' };

export default function Page() {
  return <RewardAdminDashboard />;
}
