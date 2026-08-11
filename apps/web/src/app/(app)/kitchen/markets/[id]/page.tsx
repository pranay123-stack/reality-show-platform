import type { Metadata } from 'next';

import { MarketDetail } from '@/components/kitchen-markets/market-detail';
import { KitchenMarketProvider } from '@/lib/kitchen-markets/store';

export const metadata: Metadata = { title: 'Kitchen market' };

/**
 * The provider is mounted per page rather than in the app shell.
 *
 * The store is session state for one feature; hanging it off the whole
 * authenticated tree would make every screen pay for it. Both market pages read
 * the same `sessionStorage` key, so a market created on the list is still there
 * on the detail page.
 */
export default async function KitchenMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <KitchenMarketProvider>
      <MarketDetail marketId={id} />
    </KitchenMarketProvider>
  );
}
