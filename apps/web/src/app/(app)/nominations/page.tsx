import type { Metadata } from 'next';

import { RoundScreen } from '@/components/rounds/round-screen';

export const metadata: Metadata = { title: 'Nomination round' };

export default function NominationsPage() {
  return <RoundScreen kind="nominations" />;
}
