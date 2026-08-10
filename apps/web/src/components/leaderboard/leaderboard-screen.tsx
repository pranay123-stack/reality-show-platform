'use client';

import type { LeaderboardScope, LeaderboardWindow } from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
} from '@reality/ui';
import { Check, Clock, Snowflake, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CommunitySelector } from '@/components/leaderboard/community-selector';
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table';
import { LeaderboardTabs } from '@/components/leaderboard/leaderboard-tabs';
import { UserRankCard } from '@/components/leaderboard/user-rank-card';
import {
  useCommunities,
  useConnections,
  useLeaderboard,
  useRespondToConnection,
} from '@/hooks/use-leaderboard';
import { useTrackView } from '@/hooks/use-analytics';
import { useAuth } from '@/providers/auth-provider';

export function LeaderboardScreen() {
  const { isAuthenticated } = useAuth();
  // Observation only: a view is the one thing a server cannot see for itself.
  useTrackView('leaderboard_viewed');
  const [scope, setScope] = useState<LeaderboardScope>('SEASON');
  const [window, setWindow] = useState<LeaderboardWindow>('SEASON');
  const [communityId, setCommunityId] = useState<string | null>(null);

  const communities = useCommunities();

  // Pick a community the first time that tab is opened, so it is never an
  // empty screen waiting for a click.
  useEffect(() => {
    if (scope === 'COMMUNITY' && !communityId && communities.data?.length) {
      setCommunityId(communities.data[0]!.id);
    }
  }, [scope, communityId, communities.data]);

  const { data, isLoading, isError, refetch } = useLeaderboard({
    scope,
    window,
    communityId: communityId ?? undefined,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        description="Ranked on points earned by taking part. Spending points on rewards never costs you a place."
      />

      {isAuthenticated && <FriendRequests />}

      <LeaderboardTabs
        scope={scope}
        window={window}
        onScopeChange={setScope}
        onWindowChange={setWindow}
        authenticated={isAuthenticated}
      />

      {scope === 'COMMUNITY' && (
        <CommunitySelector selectedId={communityId} onSelect={setCommunityId} />
      )}

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {data.frozen && (
            <Alert tone="info" title="This board is frozen">
              Production has paused updates while the standings are settled. Points you earn now
              still count and will appear when it reopens.
            </Alert>
          )}

          {data.me && <UserRankCard me={data.me} board={data} />}

          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
                {scope === 'FRIENDS'
                  ? 'You and your friends'
                  : scope === 'COMMUNITY'
                    ? 'Community standings'
                    : 'Top players'}
              </h2>
              <PeriodNote
                window={window}
                periodEnd={data.periodEnd}
                timezone={data.timezone}
                frozen={data.frozen}
              />
            </div>

            <LeaderboardTable
              rows={data.rows}
              emptyTitle={
                scope === 'FRIENDS'
                  ? 'No friends on the board yet'
                  : scope === 'COMMUNITY'
                    ? 'Nobody in this community has scored yet'
                    : 'Nobody has scored yet'
              }
              emptyDescription={
                scope === 'FRIENDS'
                  ? 'Add friends to compare where you stand.'
                  : 'Points earned by taking part show up here.'
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * When the board resets, and in whose clock.
 *
 * The zone is shown because the boundary belongs to the board rather than the
 * viewer — someone in a different zone would otherwise conclude the reset is
 * broken.
 */
function PeriodNote({
  window,
  periodEnd,
  timezone,
  frozen,
}: {
  window: LeaderboardWindow;
  periodEnd: string | null;
  timezone: string;
  frozen: boolean;
}) {
  if (frozen) {
    return (
      <Badge tone="warning" size="sm">
        <Snowflake className="h-3 w-3" aria-hidden />
        Frozen
      </Badge>
    );
  }

  if (window === 'SEASON' || !periodEnd) {
    return <span className="text-xs text-muted">Runs all season</span>;
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Resets{' '}
      {new Date(periodEnd).toLocaleString(undefined, {
        weekday: window === 'WEEKLY' ? 'short' : undefined,
        hour: '2-digit',
        minute: '2-digit',
      })}
      <span className="hidden sm:inline">({timezone})</span>
    </span>
  );
}

/** Incoming friend requests, answered inline rather than on another screen. */
function FriendRequests() {
  const { data } = useConnections();
  const respond = useRespondToConnection();

  const pending = (data ?? []).filter(
    (connection) =>
      connection.direction === 'incoming' &&
      connection.status === 'PENDING' &&
      connection.kind === 'FRIEND',
  );

  if (pending.length === 0) return null;

  return (
    <SectionCard
      className="p-4"
      title={
        <>
          <UserPlus className="h-4 w-4 text-primary" aria-hidden />
          Friend {pending.length === 1 ? 'request' : 'requests'}
        </>
      }
    >

      <ul className="space-y-2">
        {pending.map((connection) => (
          <li
            key={connection.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm">{connection.user.displayName}</span>
            <span className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="ghost"
                loading={respond.isPending}
                onClick={() => respond.mutate({ id: connection.id, accept: false })}
              >
                <X className="h-4 w-4" aria-hidden />
                Decline
              </Button>
              <Button
                size="sm"
                loading={respond.isPending}
                onClick={() => respond.mutate({ id: connection.id, accept: true })}
              >
                <Check className="h-4 w-4" aria-hidden />
                Accept
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
