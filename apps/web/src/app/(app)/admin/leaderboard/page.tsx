import type { Metadata } from 'next';

import { LeaderboardAdmin } from '@/components/leaderboard/leaderboard-admin';

export const metadata: Metadata = { title: 'Leaderboard operations' };

export default function Page() {
  return <LeaderboardAdmin />;
}
