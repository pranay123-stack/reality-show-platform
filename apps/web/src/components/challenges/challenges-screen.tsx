'use client';

import type { ChallengeView } from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  ChallengeCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import { Plus, ThumbsUp, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useChallengeFeed, useChallengeVote, type ChallengeScope } from '@/hooks/use-challenges';
import { useAuth } from '@/providers/auth-provider';

const TABS: { value: ChallengeScope; label: string }[] = [
  { value: 'voting', label: 'Vote now' },
  { value: 'top', label: 'Top challenges' },
  { value: 'selected', label: 'On the show' },
  { value: 'mine', label: 'Mine' },
];

export function ChallengesScreen() {
  const [scope, setScope] = useState<ChallengeScope>('voting');
  const { canParticipate } = useAuth();
  const { data, isLoading, isError, refetch } = useChallengeFeed(scope);
  const vote = useChallengeVote();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audience Challenges"
        description="Write a task for the house. The community votes, moderators check it, producers decide what actually runs."
        action={
          <Button asChild disabled={!canParticipate}>
            <Link href="/challenges/new">
              <Plus className="h-4 w-4" aria-hidden />
              Write a challenge
            </Link>
          </Button>
        }
      />

      {!canParticipate && (
        <Alert tone="warning" title="Confirm your email to take part">
          You can read and follow every challenge; writing and voting need a confirmed address.
        </Alert>
      )}

      <Tabs value={scope} onValueChange={(value) => setScope(value as ChallengeScope)}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {scope === 'top' && (
        <Alert tone="info" title="How the top challenges are chosen">
          Ranking combines community votes, when the challenge was submitted, and the author&rsquo;s
          track record. The weights are set per cycle by the production team.
        </Alert>
      )}

      {isLoading && <LoadingState rows={3} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data?.items.length === 0 && (
        <EmptyState
          title={emptyTitle(scope)}
          description={emptyDescription(scope)}
          action={
            scope === 'mine' && canParticipate ? (
              <Button asChild size="sm">
                <Link href="/challenges/new">Write your first challenge</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {data?.items.map((challenge) => (
          <li key={challenge.id}>
            <ChallengeFeedItem
              challenge={challenge}
              showRank={scope === 'top'}
              canParticipate={canParticipate}
              isVoting={vote.isPending && vote.variables?.id === challenge.id}
              onVote={() => vote.mutate({ id: challenge.id, voted: challenge.hasVoted })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChallengeFeedItem({
  challenge,
  showRank,
  canParticipate,
  isVoting,
  onVote,
}: {
  challenge: ChallengeView;
  showRank: boolean;
  canParticipate: boolean;
  isVoting: boolean;
  onVote: () => void;
}) {
  return (
    <div className="relative h-full">
      {showRank && challenge.rank != null && challenge.rank <= 3 && (
        <span className="absolute -left-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-overlay text-xs font-semibold">
          <Trophy className="h-3.5 w-3.5 text-heat-3" aria-hidden />
          <span className="sr-only">Rank {challenge.rank}</span>
        </span>
      )}

      <ChallengeCard
        title={challenge.title}
        description={challenge.description}
        category={challenge.category}
        status={challenge.status}
        author={challenge.author.displayName}
        voteCount={challenge.voteCount}
        hasVoted={challenge.hasVoted}
        isOwn={challenge.isOwn}
        className="h-full"
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/challenges/${challenge.id}`}>Details</Link>
            </Button>

            {challenge.canVote && canParticipate ? (
              <Button size="sm" variant="secondary" onClick={onVote} loading={isVoting}>
                <ThumbsUp className="h-4 w-4" aria-hidden />
                Vote
              </Button>
            ) : challenge.hasVoted ? (
              <Button size="sm" variant="ghost" onClick={onVote} loading={isVoting}>
                Voted — undo
              </Button>
            ) : (
              challenge.voteBlockedReason && (
                <Badge size="sm">{challenge.voteBlockedReason}</Badge>
              )
            )}
          </div>
        }
      />
    </div>
  );
}

function emptyTitle(scope: ChallengeScope): string {
  return {
    voting: 'Nothing in community voting',
    top: 'No top challenges yet',
    selected: 'Nothing has run on the show yet',
    mine: 'You have not written a challenge yet',
  }[scope];
}

function emptyDescription(scope: ChallengeScope): string {
  return {
    voting: 'Approved challenges appear here once a producer opens voting.',
    top: 'The best-voted challenges are promoted at the end of each cycle.',
    selected: 'Selected challenges appear here once production runs them.',
    mine: 'Write one and it goes to moderation, then to the community.',
  }[scope];
}
