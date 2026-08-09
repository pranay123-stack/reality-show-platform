import type { Metadata } from 'next';

import { ChallengesScreen } from '@/components/challenges/challenges-screen';

export const metadata: Metadata = { title: 'Audience Challenges' };

export default function ChallengesPage() {
  return <ChallengesScreen />;
}
