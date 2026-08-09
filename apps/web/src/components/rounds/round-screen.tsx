'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Countdown,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  ModalClose,
  ModalContent,
  ProgressBar,
  cn,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Info, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface RoundCandidate {
  contestantId: string;
  displayName: string;
  avatarUrl: string | null;
  tagline: string | null;
  status: string;
  eligible: boolean;
  voteCount: number;
  percentage: number;
  votedByMe: boolean;
}

interface RoundView {
  id: string;
  type: 'NOMINATION' | 'EVICTION';
  title: string;
  description: string | null;
  status: string;
  opensAt: string;
  closesAt: string;
  isOpen: boolean;
  voteMeaning: 'NOMINATE' | 'SAVE' | 'EVICT';
  maxVotesPerUser: number;
  votesUsed: number;
  votesRemaining: number;
  totalVotes: number;
  candidates: RoundCandidate[];
  audienceResult: {
    standings?: { rank: number; contestantId: string; displayName: string; percentage: number }[];
  } | null;
  officialOutcome: { contestants?: { id: string; displayName: string }[]; note?: string | null } | null;
  officialPublishedAt: string | null;
  disclaimer: string;
}

const VERB: Record<RoundView['voteMeaning'], { action: string; blurb: string }> = {
  NOMINATE: { action: 'Nominate', blurb: 'Pick who you think should face nomination.' },
  SAVE: { action: 'Save', blurb: 'Pick who you want to keep in the house.' },
  EVICT: { action: 'Vote out', blurb: 'Pick who you think should leave.' },
};

export function RoundScreen({ kind }: { kind: 'nominations' | 'evictions' }) {
  const { canParticipate } = useAuth();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<RoundCandidate | null>(null);

  const queryKey =
    kind === 'nominations' ? queryKeys.nominations.current : queryKeys.evictions.current;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => api.get<RoundView | null>(`/${kind}/current`),
    refetchInterval: 30_000,
  });

  const castVote = useMutation({
    mutationFn: ({ roundId, contestantId }: { roundId: string; contestantId: string }) =>
      api.post<{ votesRemaining: number; pointsAwarded: number }>(`/${kind}/${roundId}/votes`, {
        contestantId,
      }),
    onSuccess: async (result) => {
      toast.success(
        result.votesRemaining > 0
          ? `Vote counted · ${result.votesRemaining} left`
          : 'Vote counted · that was your last one',
      );
      setPending(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not record your vote');
      setPending(null);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const withdraw = useMutation({
    mutationFn: ({ roundId, contestantId }: { roundId: string; contestantId: string }) =>
      api.delete(`/${kind}/${roundId}/votes`, { body: { contestantId } }),
    onSuccess: async () => {
      toast.success('Vote withdrawn');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not withdraw that vote'),
  });

  if (isLoading) return <LoadingState rows={4} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  if (!data) {
    return (
      <div className="space-y-6">
        <Header kind={kind} />
        <EmptyState
          title={kind === 'nominations' ? 'No nomination round open' : 'No eviction round open'}
          description="Rounds open during the live episode and stay open for a few hours."
        />
      </div>
    );
  }

  const verb = VERB[data.voteMeaning];
  const published = data.status === 'PUBLISHED';

  return (
    <div className="space-y-6">
      <Header kind={kind} />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={data.isOpen ? 'live' : 'neutral'} size="sm">
                {data.isOpen ? 'Open' : data.status.toLowerCase()}
              </Badge>
              <Badge size="sm">{verb.action}</Badge>
            </div>
            <h2 className="text-lg font-semibold">{data.title}</h2>
            <p className="text-sm text-muted">{data.description ?? verb.blurb}</p>
          </div>

          {data.isOpen && (
            <div className="shrink-0 space-y-1 sm:text-right">
              <span className="flex items-center gap-1.5 text-sm">
                <Clock className="h-4 w-4 text-muted" aria-hidden />
                <Countdown to={data.closesAt} finishedLabel="Closed" />
              </span>
              <p className="text-xs text-muted tabular-nums">
                {data.totalVotes.toLocaleString()} votes cast
              </p>
            </div>
          )}
        </div>

        {data.isOpen && (
          <div className="rounded-md border border-border bg-surface-raised p-3">
            <ProgressBar
              value={data.votesUsed}
              max={data.maxVotesPerUser}
              tone={data.votesRemaining === 0 ? 'warning' : 'primary'}
              label={`Your votes: ${data.votesUsed} of ${data.maxVotesPerUser} used`}
              showValue={false}
            />
            <p className="mt-1.5 text-xs text-muted">
              {data.votesRemaining > 0
                ? `${data.votesRemaining} vote${data.votesRemaining === 1 ? '' : 's'} remaining`
                : 'You have used all your votes. Withdraw one to change your mind.'}
            </p>
          </div>
        )}
      </Card>

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to take part">
          You can follow the round; voting needs a confirmed address.
        </Alert>
      )}

      {/* The single most important thing on this screen. */}
      <Alert tone="info" title="This is the audience view">
        {data.disclaimer}
      </Alert>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.candidates.map((candidate) => (
          <li key={candidate.contestantId}>
            <Card
              className={cn(
                'flex h-full flex-col gap-3 p-4',
                candidate.votedByMe && 'border-primary/50 bg-primary/5',
                !candidate.eligible && 'opacity-60',
              )}
            >
              <div className="flex items-start gap-3">
                <Avatar name={candidate.displayName} src={candidate.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{candidate.displayName}</p>
                  {candidate.tagline && (
                    <p className="line-clamp-2 text-xs text-muted">{candidate.tagline}</p>
                  )}
                  {!candidate.eligible && (
                    <Badge tone="warning" size="sm" className="mt-1">
                      Not eligible
                    </Badge>
                  )}
                </div>
              </div>

              {published && (
                <ProgressBar
                  value={candidate.percentage}
                  max={100}
                  size="sm"
                  tone="accent"
                  label={`${candidate.displayName}: ${candidate.percentage}%`}
                  showValue
                />
              )}

              {data.isOpen && candidate.eligible && (
                <div className="mt-auto">
                  {candidate.votedByMe ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      loading={
                        withdraw.isPending &&
                        withdraw.variables?.contestantId === candidate.contestantId
                      }
                      onClick={() =>
                        withdraw.mutate({
                          roundId: data.id,
                          contestantId: candidate.contestantId,
                        })
                      }
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      Voted — withdraw
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      fullWidth
                      disabled={!canParticipate || data.votesRemaining === 0}
                      onClick={() => setPending(candidate)}
                    >
                      {verb.action}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {published && <ResultPanel round={data} />}

      {/* Confirmation, because a vote cannot be spent twice by accident. */}
      <Modal open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <ModalContent
          title={`${verb.action} ${pending?.displayName ?? ''}?`}
          description={`This uses one of your ${data.maxVotesPerUser} votes in this round. You can withdraw it while the round is open.`}
          footer={
            <>
              <ModalClose asChild>
                <Button variant="ghost">Cancel</Button>
              </ModalClose>
              <Button
                loading={castVote.isPending}
                onClick={() =>
                  pending &&
                  castVote.mutate({ roundId: data.id, contestantId: pending.contestantId })
                }
              >
                Confirm
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            After this you will have {Math.max(0, data.votesRemaining - 1)} vote
            {data.votesRemaining - 1 === 1 ? '' : 's'} left.
          </p>
        </ModalContent>
      </Modal>
    </div>
  );
}

function Header({ kind }: { kind: 'nominations' | 'evictions' }) {
  return (
    <header className="space-y-1">
      <h1 className="text-display-md font-semibold">
        {kind === 'nominations' ? 'Nomination' : 'Eviction'} round
      </h1>
      <p className="text-muted">
        Take part in the audience vote. Your votes are limited and always your own.
      </p>
    </header>
  );
}

/**
 * Results are shown in two clearly separated blocks: what the audience here
 * voted for, and — only if production has published it — what the show actually
 * did. They are never merged into a single "result".
 */
function ResultPanel({ round }: { round: RoundView }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-accent" aria-hidden />
            Audience result
          </CardTitle>
          <p className="text-xs text-muted">How people on this platform voted.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {round.audienceResult?.standings?.map((entry) => (
            <div key={entry.contestantId} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="w-5 text-center font-mono text-xs text-muted">{entry.rank}</span>
                {entry.displayName}
              </span>
              <span className="font-mono tabular-nums">{entry.percentage}%</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={round.officialOutcome ? 'border-success/40' : 'border-dashed'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck
              className={cn('h-4 w-4', round.officialOutcome ? 'text-success' : 'text-muted')}
              aria-hidden
            />
            Official show outcome
          </CardTitle>
          <p className="text-xs text-muted">Published by the production team only.</p>
        </CardHeader>
        <CardContent>
          {round.officialOutcome ? (
            <div className="space-y-2">
              {round.officialOutcome.contestants?.map((contestant) => (
                <p key={contestant.id} className="text-sm font-medium">
                  {contestant.displayName}
                </p>
              ))}
              {round.officialOutcome.note && (
                <p className="text-sm text-muted">{round.officialOutcome.note}</p>
              )}
              {round.officialPublishedAt && (
                <p className="text-xs text-muted">
                  Announced {new Date(round.officialPublishedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="flex items-start gap-2 text-sm text-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Not announced yet. The audience result above does not decide this.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
