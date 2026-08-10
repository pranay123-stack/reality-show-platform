'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@reality/ui';
import { AlertTriangle, Check, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';

import { useModerateChallenge, useModerationQueue } from '@/hooks/use-challenges';
import { useAuth } from '@/providers/auth-provider';

/**
 * Moderator queue.
 *
 * Escalated and reported items sort to the top, and the auto-screening flags are
 * shown so a moderator knows *why* something was escalated rather than having to
 * re-read every submission from scratch.
 */
export function ModerationQueue() {
  const [reportedOnly, setReportedOnly] = useState(false);
  const { can } = useAuth();
  const { data, isLoading, isError, refetch } = useModerationQueue(reportedOnly);
  const moderate = useModerateChallenge();

  if (!can('challenge.moderate')) {
    return (
      <Alert tone="danger" title="Not available">
        You do not have moderation access.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        size="compact"
        title="Challenge moderation"
        description="Nothing reaches community voting until a human approves it."
        action={
          <Tabs
            value={reportedOnly ? 'reported' : 'queue'}
            onValueChange={(value) => setReportedOnly(value === 'reported')}
          >
            <TabsList>
              <TabsTrigger value="queue">Awaiting review</TabsTrigger>
              <TabsTrigger value="reported">Reported</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {isLoading && <LoadingState rows={3} />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {data?.length === 0 && (
        <EmptyState
          title={reportedOnly ? 'No reported challenges' : 'Queue is clear'}
          description="New submissions appear here as soon as they are sent for review."
        />
      )}

      <ul className="space-y-4">
        {data?.map((challenge) => (
          <li key={challenge.id}>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={challenge.moderationStatus === 'ESCALATED' ? 'warning' : 'neutral'}
                      size="sm"
                    >
                      {challenge.moderationStatus.toLowerCase()}
                    </Badge>
                    <Badge size="sm">{challenge.category.toLowerCase()}</Badge>
                    <Badge size="sm">
                      {challenge.targetType === 'HOUSE'
                        ? 'Whole house'
                        : (challenge.targetContestant?.displayName ?? 'One contestant')}
                    </Badge>
                    {challenge.reportCount > 0 && (
                      <Badge tone="danger" size="sm">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {challenge.reportCount} report{challenge.reportCount === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>

                  <h2 className="font-semibold">{challenge.title}</h2>
                  <p className="text-xs text-muted">
                    {challenge.author.displayName} ({challenge.authorEmail}) ·{' '}
                    {new Date(challenge.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => moderate.mutate({ id: challenge.id, decision: 'APPROVE' })}
                    loading={moderate.isPending && moderate.variables?.id === challenge.id}
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => moderate.mutate({ id: challenge.id, decision: 'REJECT' })}
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moderate.mutate({ id: challenge.id, decision: 'ESCALATE' })}
                    aria-label="Escalate"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>

              <p className="mt-3 whitespace-pre-wrap rounded-md bg-surface-raised p-3 text-sm">
                {challenge.description}
              </p>

              {challenge.contentFlags.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">Automatic flags:</span>
                  {challenge.contentFlags.map((flag) => (
                    <Badge key={flag} tone="warning" size="sm">
                      {flag}
                    </Badge>
                  ))}
                </div>
              )}

              {challenge.moderationNotes && (
                <p className="mt-2 text-xs text-muted">{challenge.moderationNotes}</p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
