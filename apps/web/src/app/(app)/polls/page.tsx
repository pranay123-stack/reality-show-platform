import type { Metadata } from 'next';

import { PollsScreen } from '@/components/polls/polls-screen';

export const metadata: Metadata = { title: 'Live Polls' };

export default function PollsPage() {
  return <PollsScreen />;
}
