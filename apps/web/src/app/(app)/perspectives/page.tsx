import type { Metadata } from 'next';

import { PerspectivesScreen } from '@/components/perspectives/perspectives-screen';

export const metadata: Metadata = { title: 'Audience Perspective' };

export default function PerspectivesPage() {
  return <PerspectivesScreen />;
}
