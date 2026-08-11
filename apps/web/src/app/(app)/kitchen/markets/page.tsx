import type { Metadata } from 'next';

import { KitchenMarketsScreen } from '@/components/kitchen-markets/markets-screen';
import { KitchenMarketProvider } from '@/lib/kitchen-markets/store';

export const metadata: Metadata = { title: 'Kitchen Markets' };

export default function KitchenMarketsPage() {
  return (
    <KitchenMarketProvider>
      <KitchenMarketsScreen />
    </KitchenMarketProvider>
  );
}
