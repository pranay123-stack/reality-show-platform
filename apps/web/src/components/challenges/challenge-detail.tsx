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
  ErrorState,
  LoadingState,
  Modal,
  ModalContent,
  ModalTrigger,
} from '@reality/ui';
import { ArrowLeft, Flag, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useChallenge, useChallengeVote, useReportChallenge } from '@/hooks/use-challenges';
import { useAuth } from '@/providers/auth-provider';

const LIFECYCLE = [
  { status: 'MODERATION', label: 'Moderation' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'COMMUNITY_VOTING', label: 'Community voting' },
  { status: 'TOP_CHALLENGES', label: 'Top challenges' },
  { status: 'PRODUCER_REVIEW', label: 'Producer review' },
  { status: 'SELECTED', label: 'Selected' },
  { status: 'EXECUTED', label: 'Ran on the show' },
  { status: 'COMPLETED', label: 'Completed' },
];

const REPORT_REASONS = [
  { value: 'SPAM', label: 'Spam or self-promotion' },
  { value: 'OFFENSIVE', label: 'Offensive or abusive' },
  { value: 'UNSAFE', label: 'Unsafe for contestants' },
  { value: 'OFF_TOPIC', label: 'Nothing to do with the show' },
  { value: 'DUPLICATE', label: 'Duplicate of another challenge' },
  { value: 'OTHER', label: 'Something else' },
];

export function ChallengeDetail({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = useChallenge(id);
  const { canParticipate } = useAuth();
  const vote = useChallengeVote();
  const report = useReportChallenge();
  const [reportReason, setReportReason] = useState('SPAM');
  const [reportDetails, setReportDetails] = useState('');

  if (isLoading) return <LoadingState rows={4} />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const currentStep = LIFECYCLE.findIndex((step) => step.status === data.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/challenges"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All challenges
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={data.status === 'REJECTED' ? 'danger' : 'primary'} size="sm">
            {data.status.replace(/_/g, ' ').toLowerCase()}
          </Badge>
          <Badge size="sm">{data.category.toLowerCase()}</Badge>
          <Badge size="sm">
            {data.targetType === 'HOUSE'
              ? 'Whole house'
              : (data.targetContestant?.displayName ?? 'One contestant')}
          </Badge>
          {data.isOwn && (
            <Badge tone="primary" size="sm">
              Yours
            </Badge>
          )}
        </div>

        <h1 className="text-display-md font-semibold">{data.title}</h1>

        <div className="flex items-center gap-2 text-sm text-muted">
          <Avatar name={data.author.displayName} src={data.author.avatarUrl} size="sm" />
          {data.author.displayName} · {new Date(data.createdAt).toLocaleDateString()}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="whitespace-pre-wrap leading-relaxed">{data.description}</p>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-sm text-muted">
              <span className="font-semibold text-foreground tabular-nums">
                {data.voteCount.toLocaleString()}
              </span>{' '}
              {data.voteCount === 1 ? 'vote' : 'votes'}
            </span>

            <div className="flex items-center gap-2">
              {data.canVote && canParticipate ? (
                <Button
                  onClick={() => vote.mutate({ id: data.id, voted: data.hasVoted })}
                  loading={vote.isPending}
                >
                  <ThumbsUp className="h-4 w-4" aria-hidden />
                  Vote for this
                </Button>
              ) : data.hasVoted ? (
                <Button
                  variant="secondary"
                  onClick={() => vote.mutate({ id: data.id, voted: true })}
                  loading={vote.isPending}
                >
                  Voted — undo
                </Button>
              ) : (
                data.voteBlockedReason && <Badge>{data.voteBlockedReason}</Badge>
              )}

              {!data.isOwn && canParticipate && (
                <Modal>
                  <ModalTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Report this challenge">
                      <Flag className="h-4 w-4" aria-hidden />
                    </Button>
                  </ModalTrigger>
                  <ModalContent
                    title="Report this challenge"
                    description="A moderator reviews every report. Nothing is removed automatically."
                    footer={
                      <Button
                        onClick={() =>
                          report.mutate({
                            id: data.id,
                            reason: reportReason,
                            details: reportDetails || undefined,
                          })
                        }
                        loading={report.isPending}
                      >
                        Send report
                      </Button>
                    }
                  >
                    <div className="space-y-3">
                      <select
                        aria-label="Reason"
                        className="h-11 w-full rounded-md border border-border bg-input px-3.5 text-foreground"
                        value={reportReason}
                        onChange={(event) => setReportReason(event.target.value)}
                      >
                        {REPORT_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </select>

                      <textarea
                        aria-label="Extra detail"
                        rows={3}
                        maxLength={500}
                        placeholder="Anything else the moderator should know (optional)"
                        className="w-full rounded-md border border-border bg-input px-3.5 py-2.5 text-sm text-foreground"
                        value={reportDetails}
                        onChange={(event) => setReportDetails(event.target.value)}
                      />
                    </div>
                  </ModalContent>
                </Modal>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {data.resultNotes && (
        <Alert tone="success" title="What happened">
          {data.resultNotes}
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted">
            Where it is
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {LIFECYCLE.map((step, index) => {
              const done = currentStep >= 0 && index < currentStep;
              const active = index === currentStep;

              return (
                <li key={step.status} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      active ? 'bg-primary' : done ? 'bg-success' : 'bg-border-strong'
                    }`}
                  />
                  <span className={active ? 'font-medium' : done ? 'text-muted' : 'text-muted/60'}>
                    {step.label}
                  </span>
                  {active && (
                    <Badge tone="primary" size="sm">
                      Now
                    </Badge>
                  )}
                </li>
              );
            })}
          </ol>

          {data.status === 'REJECTED' && (
            <Alert tone="danger" className="mt-4" title="Not approved">
              A moderator decided this one cannot run.
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
