import type { Metadata } from 'next';

import { KitchenSection } from '@/components/admin/kitchen-section';

export const metadata: Metadata = { title: 'Kitchen' };

export default function Page() {
  return <KitchenSection />;
}
