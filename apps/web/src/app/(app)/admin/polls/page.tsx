import type { Metadata } from 'next';

import { PollsSection } from '@/components/admin/polls-section';

export const metadata: Metadata = { title: 'Polls' };

export default function Page() {
  return <PollsSection />;
}
