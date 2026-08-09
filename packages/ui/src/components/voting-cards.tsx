'use client';

import { CheckCircle2, Clock, Radio, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Card } from './card';
import { Countdown } from './countdown';
import { OptionResult } from './domain';
import { Badge, LiveIndicator } from './primitives';

export interface VoteOption {
  id: string;
  label: string;
  voteCount?: number;
}

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

export interface PollCardProps {
  question: string;
  description?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'PUBLISHED';
  options: VoteOption[];
  totalVotes: number;
  closesAt?: string | null;
  selectedOptionId?: string | null;
  winningOptionId?: string | null;
  onVote?: (optionId: string) => void;
  isSubmitting?: boolean;
  disabledReason?: string;
  className?: string;
  footer?: ReactNode;
}

export function PollCard({
  question,
  description,
  status,
  options,
  totalVotes,
  closesAt,
  selectedOptionId,
  winningOptionId,
  onVote,
  isSubmitting,
  disabledReason,
  className,
  footer,
}: PollCardProps) {
  const isOpen = status === 'ACTIVE';
  const hasVoted = Boolean(selectedOptionId);
  // Counts stay hidden while a poll is live and the viewer has not voted, so the
  // running tally cannot nudge their choice.
  const hideCounts = isOpen && !hasVoted;

  return (
    <Card className={cn('space-y-4 p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <LiveIndicator live={isOpen} label={isOpen ? 'Live poll' : status.toLowerCase()} />
            {status === 'PAUSED' && <Badge tone="warning" size="sm">Paused</Badge>}
          </div>
          <h3 className="text-lg font-semibold leading-tight">{question}</h3>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>

        {closesAt && isOpen && (
          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="h-4 w-4 text-muted" aria-hidden />
            <Countdown to={closesAt} finishedLabel="Closing…" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {options.map((option) => {
          const selected = option.id === selectedOptionId;
          const winner = option.id === winningOptionId;

          if (isOpen && !hasVoted && onVote) {
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onVote(option.id)}
                disabled={isSubmitting}
                className={cn(
                  'w-full rounded-md border border-border bg-surface-raised px-4 py-3 text-left text-sm font-medium',
                  'transition-colors hover:border-primary hover:bg-primary/10',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                {option.label}
              </button>
            );
          }

          return (
            <OptionResult
              key={option.id}
              label={option.label}
              votes={option.voteCount ?? 0}
              total={totalVotes}
              selected={selected}
              winner={winner}
              hideCounts={hideCounts}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span className="tabular-nums">
          {hideCounts ? 'Results appear once you vote' : `${totalVotes.toLocaleString()} votes`}
        </span>
        {hasVoted && (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Vote counted
          </span>
        )}
        {!hasVoted && disabledReason && <span>{disabledReason}</span>}
      </div>

      {footer}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export interface PredictionCardProps {
  question: string;
  description?: string | null;
  status: 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'RESOLVED' | 'CANCELLED';
  options: VoteOption[];
  closesAt: string;
  rewardPoints: number;
  participationPoints: number;
  entryCount: number;
  selectedOptionId?: string | null;
  correctOptionId?: string | null;
  onSelect?: (optionId: string) => void;
  isSubmitting?: boolean;
  disabledReason?: string;
  className?: string;
}

export function PredictionCard({
  question,
  description,
  status,
  options,
  closesAt,
  rewardPoints,
  participationPoints,
  entryCount,
  selectedOptionId,
  correctOptionId,
  onSelect,
  isSubmitting,
  disabledReason,
  className,
}: PredictionCardProps) {
  const isOpen = status === 'OPEN';
  const hasEntry = Boolean(selectedOptionId);
  const resolved = status === 'RESOLVED';
  const wasCorrect = resolved && selectedOptionId != null && selectedOptionId === correctOptionId;

  return (
    <Card className={cn('space-y-4 p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isOpen ? 'primary' : resolved ? 'success' : 'neutral'} size="sm">
              <Radio className="h-3 w-3" aria-hidden />
              {status.toLowerCase()}
            </Badge>
            <Badge size="sm">
              <Sparkles className="h-3 w-3" aria-hidden />
              {rewardPoints} pts if correct
            </Badge>
          </div>
          <h3 className="text-lg font-semibold leading-tight">{question}</h3>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>

        {isOpen && (
          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="h-4 w-4 text-muted" aria-hidden />
            <Countdown to={closesAt} finishedLabel="Closed" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {options.map((option) => {
          const selected = option.id === selectedOptionId;
          const winner = resolved && option.id === correctOptionId;

          if (isOpen && !hasEntry && onSelect) {
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                disabled={isSubmitting}
                className={cn(
                  'w-full rounded-md border border-border bg-surface-raised px-4 py-3 text-left text-sm font-medium',
                  'transition-colors hover:border-primary hover:bg-primary/10',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                {option.label}
              </button>
            );
          }

          return (
            <OptionResult
              key={option.id}
              label={option.label}
              votes={option.voteCount ?? 0}
              total={entryCount}
              selected={selected}
              winner={winner}
              // Entry distribution stays hidden until the question is resolved,
              // so nobody can follow the crowd.
              hideCounts={!resolved}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
        <span className="tabular-nums">{entryCount.toLocaleString()} predictions</span>

        {resolved && hasEntry && (
          <span className={cn('font-medium', wasCorrect ? 'text-success' : 'text-muted')}>
            {wasCorrect ? `Correct — +${rewardPoints} points` : 'Not this time'}
          </span>
        )}

        {isOpen && hasEntry && (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Locked in (+{participationPoints})
          </span>
        )}

        {isOpen && !hasEntry && disabledReason && <span>{disabledReason}</span>}
      </div>
    </Card>
  );
}
