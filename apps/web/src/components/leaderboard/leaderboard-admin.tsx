'use client';

import type { LeaderboardView, LeaderboardWindow, RankingExplanationView } from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  LoadingState,
  cn,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Search, Snowflake } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table';
import { ApiError, api } from '@/lib/api-client';
import { env } from '@/lib/env';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const WINDOWS: LeaderboardWindow[] = ['DAILY', 'WEEKLY', 'SEASON'];

/**
 * Leaderboard operations.
 *
 * The inspector is the important part: it recomputes a user's score from the
 * ledger and shows it next to the cached one, so "is this ranking real" has an
 * answer rather than an assurance.
 */
export function LeaderboardAdmin() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [window, setWindow] = useState<LeaderboardWindow>('SEASON');

  const board = useQuery({
    queryKey: queryKeys.admin.section('leaderboard', window),
    queryFn: () => api.get<LeaderboardView>(`/leaderboards?window=${window}`),
  });

  const rebuild = useMutation({
    mutationFn: () => api.post('/leaderboards/admin/rebuild', { window }),
    onSuccess: async (result: unknown) => {
      const data = result as { users: number };
      toast.success(`Rebuilt from the ledger · ${data.users} users`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('leaderboard', window) });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not rebuild that board'),
  });

  const snapshot = useMutation({
    mutationFn: () => api.post('/leaderboards/admin/snapshot', { window }),
    onSuccess: async () => {
      toast.success('Snapshot taken — rank movement now measures from here');
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('leaderboard', window) });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not take a snapshot'),
  });

  const freeze = useMutation({
    mutationFn: (frozen: boolean) => api.post('/leaderboards/admin/freeze', { window, frozen }),
    onSuccess: async (_result, frozen) => {
      toast.success(frozen ? 'Board frozen' : 'Board reopened and rebuilt');
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('leaderboard', window) });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change that board'),
  });

  if (!can('leaderboard.inspect')) {
    return (
      <Alert tone="danger" title="Not available">
        You do not have access to leaderboard operations.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-display-md font-semibold">Leaderboard operations</h1>
        <p className="text-muted">
          Every ranking here is derived from the points ledger. Nothing on this page can set a
          score — only recompute one.
        </p>
      </header>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {WINDOWS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={window === entry}
            onClick={() => setWindow(entry)}
            className={cn(
              'shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors',
              window === entry
                ? 'border-primary/50 bg-primary/15 text-foreground'
                : 'border-border text-muted hover:border-border-strong hover:text-foreground',
            )}
          >
            {entry.toLowerCase()}
          </button>
        ))}
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">
              {board.data?.periodKey ?? '—'}
              {board.data?.frozen && (
                <Badge tone="warning" size="sm" className="ml-2">
                  Frozen
                </Badge>
              )}
            </h2>
            <p className="text-xs text-muted">
              {board.data?.totalRanked.toLocaleString() ?? 0} ranked · boundaries in{' '}
              {board.data?.timezone ?? 'UTC'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {can('leaderboard.rebuild') && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={rebuild.isPending}
                  onClick={() => rebuild.mutate()}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Rebuild cache
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={snapshot.isPending}
                  onClick={() => snapshot.mutate()}
                >
                  Snapshot
                </Button>
              </>
            )}

            {can('leaderboard.freeze') && (
              <Button
                size="sm"
                variant={board.data?.frozen ? 'primary' : 'danger'}
                loading={freeze.isPending}
                onClick={() => freeze.mutate(!board.data?.frozen)}
              >
                <Snowflake className="h-4 w-4" aria-hidden />
                {board.data?.frozen ? 'Reopen' : 'Freeze'}
              </Button>
            )}

            {can('leaderboard.export') && (
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={`${env.apiUrl}/api/v1/leaderboards/admin/export?window=${window}&format=csv`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Export CSV
                </a>
              </Button>
            )}
          </div>
        </div>

        {board.data?.frozen && (
          <Alert tone="info">
            While frozen the board ignores new points. Reopening rebuilds it from the ledger, so
            nothing earned in the meantime is lost.
          </Alert>
        )}

        {board.isLoading ? (
          <LoadingState rows={4} />
        ) : (
          <LeaderboardTable rows={board.data?.rows ?? []} />
        )}
      </Card>

      <RankingInspector window={window} />
    </div>
  );
}

/** Recomputes a score from the ledger and compares it with the cached one. */
function RankingInspector({ window }: { window: LeaderboardWindow }) {
  const [userId, setUserId] = useState('');
  const [result, setResult] = useState<RankingExplanationView | null>(null);

  const inspect = useMutation({
    mutationFn: (id: string) =>
      api.get<RankingExplanationView>(
        `/leaderboards/admin/inspect?window=${window}&userId=${encodeURIComponent(id)}`,
      ),
    onSuccess: setResult,
    onError: (error: unknown) => {
      setResult(null);
      toast.error(error instanceof ApiError ? error.message : 'Could not inspect that ranking');
    },
  });

  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Inspect a ranking</h2>
        <p className="text-xs text-muted">
          Recomputes the score from the ledger and compares it against the cache.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FormField label="User id" htmlFor="inspect-user" className="min-w-0 flex-1">
          <Input
            id="inspect-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="usr_…"
          />
        </FormField>
        <Button
          loading={inspect.isPending}
          disabled={userId.trim().length === 0}
          onClick={() => inspect.mutate(userId.trim())}
        >
          <Search className="h-4 w-4" aria-hidden />
          Inspect
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{result.displayName}</span>
            <Badge tone={result.consistent ? 'success' : 'danger'}>
              {result.consistent ? 'Cache matches ledger' : 'Cache disagrees with ledger'}
            </Badge>
            {result.rank !== null && <Badge tone="neutral">Rank #{result.rank}</Badge>}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Cached" value={result.cachedScore.toLocaleString()} />
            <Stat label="From ledger" value={result.ledgerScore.toLocaleString()} />
            <Stat label="Ledger rows" value={String(result.entryCount)} />
            <Stat label="Period" value={result.periodKey} />
          </dl>

          {!result.consistent && (
            <Alert tone="danger" title="Rebuild this board">
              The cached score does not match the ledger. The ledger is correct; rebuilding
              recomputes the cache from it.
            </Alert>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 text-right font-medium">Points</th>
                  <th className="py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {result.contributions.map((row, index) => (
                  <tr key={`${row.reason}-${index}`} className="border-b border-border/50">
                    <td className="py-2 pr-3">{row.sourceType.toLowerCase()}</td>
                    <td className="py-2 pr-3 text-muted">{row.reason}</td>
                    <td className="py-2 pr-3 text-muted">{row.entryType.toLowerCase()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.delta > 0 ? '+' : ''}
                      {row.delta}
                    </td>
                    <td className="py-2 text-right text-xs text-muted">
                      {new Date(row.at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
