'use client';

import {
  Alert,
  ContestantCard,
  EmptyState,
  ErrorState,
  LoadingState,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import Link from 'next/link';
import { useState } from 'react';

import { useContestants } from '@/hooks/use-contestants';

export function ContestantsScreen() {
  const [sort, setSort] = useState<'heat' | 'name'>('heat');
  const { data, isLoading, isError, refetch } = useContestants(sort);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-display-md font-semibold">House Heat</h1>
          <p className="text-muted">
            How much attention each contestant is getting right now, computed on the server.
          </p>
        </div>

        <Tabs value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
          <TabsList>
            <TabsTrigger value="heat">By heat</TabsTrigger>
            <TabsTrigger value="name">A–Z</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <Alert tone="info">
        Heat measures <strong>contestants on the show</strong>. It is separate from the viewer
        leaderboard and the two are never combined.
      </Alert>

      {isLoading && <LoadingState rows={4} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data && data.length === 0 && (
        <EmptyState title="No contestants yet" description="They appear once the show is set up." />
      )}

      {data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((contestant, index) => (
            <li key={contestant.id}>
              <Link
                href={`/contestants/${contestant.slug}`}
                className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ContestantCard
                  name={contestant.displayName}
                  tagline={contestant.tagline}
                  avatarUrl={contestant.avatarUrl}
                  occupation={contestant.occupation}
                  heatScore={contestant.heatScore}
                  heatTrend={contestant.heatTrend}
                  status={contestant.status}
                  rank={sort === 'heat' ? index + 1 : undefined}
                  className="h-full"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
