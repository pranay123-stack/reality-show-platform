import type { Metadata } from 'next';

import { ChallengesScreen } from '@/components/challenges/challenges-screen';

export const metadata: Metadata = { title: 'Change The House' };

export default function ChallengesPage() {
  return <ChallengesScreen />;
}
