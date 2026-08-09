import type { Metadata } from 'next';

import { ModerationQueue } from '@/components/challenges/moderation-queue';

export const metadata: Metadata = { title: 'Challenge moderation' };

export default function ChallengeModerationPage() {
  return <ModerationQueue />;
}
