import type { Metadata } from 'next';

import { KitchenScreen } from '@/components/kitchen/kitchen-screen';

export const metadata: Metadata = { title: 'Kitchen Battle' };

export default function KitchenPage() {
  return <KitchenScreen />;
}
