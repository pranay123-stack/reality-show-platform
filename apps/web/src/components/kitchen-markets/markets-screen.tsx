'use client';

import type { KitchenMarketCategory } from '@reality/shared';
import { KITCHEN_CATEGORY_LABELS, KITCHEN_MARKET_CATEGORIES } from '@reality/shared';
import { Alert, EmptyState, FilterChips, LoadingState, PageHeader, SectionCard } from '@reality/ui';
import { motion } from 'framer-motion';
import { ChefHat } from 'lucide-react';
import { useMemo, useState } from 'react';

import { KitchenChampions, MyStandingCard } from '@/components/kitchen-markets/champions';
import { CreateMarketButton, CreateMarketDialog } from '@/components/kitchen-markets/create-market';
import { MarketCard } from '@/components/kitchen-markets/market-card';
import { useKitchenMarkets } from '@/lib/kitchen-markets/store';
import { stagger, viewportOnce } from '@/lib/motion';
import { useAuth } from '@/providers/auth-provider';

type Filter = 'all' | 'live' | 'mine' | 'settled' | KitchenMarketCategory;

/**
 * Kitchen Markets.
 *
 * The audience side of the kitchen: markets people create about what the house
 * will do, and the predictions they make on them. Production's budgeted food
 * decision lives at `/kitchen` and is a different thing entirely — that one
 * spends money and is resolved by an operator.
 */
export function KitchenMarketsScreen() {
  const { user, canParticipate } = useAuth();
  const store = useKitchenMarkets();
  const [filter, setFilter] = useState<Filter>('all');
  const [composing, setComposing] = useState(false);

  const markets = useMemo(() => {
    const all = store.markets;
    if (filter === 'all') return all;
    if (filter === 'live') return all.filter((market) => market.status === 'OPEN');
    if (filter === 'settled') return all.filter((market) => market.status === 'RESOLVED');
    if (filter === 'mine') return all.filter((market) => market.myOptionId || market.creator.id === user?.id);
    return all.filter((market) => market.category === filter);
  }, [store.markets, filter, user?.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kitchen Markets"
        description="Predict what the house does next — or write the market everyone else predicts on."
        action={canParticipate ? <CreateMarketButton onClick={() => setComposing(true)} /> : undefined}
      />

      {/*
        Said plainly and up front. This platform's entire points model rests on
        the server being the only thing that can award a point, and a market
        that scored into the real ledger from a browser would break that. It
        does not, so the page says so rather than letting a reader assume.
      */}
      <Alert tone="info" title="Preview feature">
        Kitchen Markets runs in your browser while the server module is built. Market points are
        separate from your platform points, do not appear on the leaderboard, and reset when you
        close the tab.
      </Alert>

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to take part">
          You can look around, but creating a market and predicting on one stay locked until your
          address is confirmed.
        </Alert>
      )}

      <MyStandingCard
        points={store.myPoints}
        predictions={store.myPredictions}
        created={store.myMarketsCreated}
      />

      <FilterChips
        label="Filter markets"
        value={filter}
        onChange={(next) => setFilter(next as Filter)}
        options={[
          { value: 'all', label: 'All', count: store.markets.length },
          { value: 'live', label: 'Live' },
          { value: 'mine', label: 'Mine' },
          { value: 'settled', label: 'Settled' },
          ...KITCHEN_MARKET_CATEGORIES.map((category) => ({
            value: category,
            label: KITCHEN_CATEGORY_LABELS[category],
          })),
        ]}
      />

      {!store.ready ? (
        <LoadingState rows={3} label="Loading tonight’s markets…" />
      ) : markets.length === 0 ? (
        <EmptyState
          title="No markets here yet"
          description={
            filter === 'mine'
              ? 'Predict on one, or write your own — it appears here either way.'
              : 'Nothing matches that filter right now.'
          }
          icon={<ChefHat className="h-5 w-5" aria-hidden />}
        />
      ) : (
        <motion.ul
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {markets.map((market) => (
            <li key={market.id}>
              <MarketCard market={market} />
            </li>
          ))}
        </motion.ul>
      )}

      <SectionCard
        title="Today’s kitchen champions"
        description="Ranked on markets called correctly today."
        bodyClassName="pt-1"
      >
        <KitchenChampions stats={store.stats} />
      </SectionCard>

      <CreateMarketDialog
        open={composing}
        onClose={() => setComposing(false)}
        onCreate={(input) =>
          store.createMarket(input, {
            id: user?.id ?? 'anonymous',
            displayName: user?.displayName ?? 'You',
          })
        }
      />
    </div>
  );
}
