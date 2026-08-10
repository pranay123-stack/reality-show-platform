import type { Metadata } from 'next';

import { PerspectivesScreen } from '@/components/perspectives/perspectives-screen';

export const metadata: Metadata = { title: 'Pick A Side' };

export default function PerspectivesPage() {
  return <PerspectivesScreen />;
}
