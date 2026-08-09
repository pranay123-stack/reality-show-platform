import type { Metadata } from 'next';

import { CreateChallengeForm } from '@/components/challenges/create-challenge-form';

export const metadata: Metadata = { title: 'Write a challenge' };

export default function NewChallengePage() {
  return <CreateChallengeForm />;
}
