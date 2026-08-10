'use client';

import type { WeekendRoundView } from '@reality/shared';
import { Alert, Badge, Button, Card, ErrorState, LoadingState } from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ActionDialog, StatusBadge, StatusPills } from '@/components/admin/primitives';
import { SectionHeader, useAdminMutation } from '@/components/admin/section-header';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface AdminSubmission {
  id: string;
  userId: string;
  displayName?: string;
  participationType: string;
  content: string;
  status: string;
  moderationStatus: string;
  shortlistedAt: string | null;
  createdAt: string;
}

const FUNNEL = ['OPEN', 'SUBMIT', 'MODERATION', 'SHORTLIST', 'PRODUCER_SELECTION', 'SELECTED', 'COMPLETED'];

export function WeekendSection() {
  const { can } = useAuth();
  const [roundId, setRoundId] = useState<string | null>(null);

  const key = queryKeys.admin.section('weekend');
  const rounds = useQuery({
    queryKey: key,
    queryFn: () => api.get<WeekendRoundView[]>('/weekend/admin/list'),
  });

  const advance = useAdminMutation({
    key,
    fn: ({ id, to }: { id: string; to: string }) => api.post(`/weekend/admin/${id}/advance`, { to }),
    success: 'Round advanced',
  });

  if (!can('weekend.manage')) {
    return (
      <Alert tone="danger" title="Not available">
        Running weekend participation is a producer action.
      </Alert>
    );
  }

  if (rounds.isError) return <ErrorState onRetry={() => void rounds.refetch()} />;
  if (rounds.isLoading) return <LoadingState rows={4} />;

  const list = rounds.data ?? [];
  const selected = list.find((round) => round.id === roundId) ?? list[0] ?? null;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Weekend participation"
        description="A seven-step funnel. Nothing reaches the shortlist without passing a human first."
      />

      {list.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">
          No weekend rounds yet. Create one from the weekend module.
        </Card>
      ) : (
        <>
          <StatusPills
            label="Rounds"
            value={selected?.id ?? ''}
            onChange={setRoundId}
            options={list.map((round) => ({ value: round.id, label: round.title }))}
          />

          {selected && (
            <>
              <Card className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="font-semibold">{selected.title}</h2>
                    <p className="text-xs text-muted">
                      Closes {new Date(selected.submissionDeadline).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>

                <Funnel status={selected.status} />

                <div className="flex flex-wrap gap-2">
                  {nextSteps(selected.status).map((step) => (
                    <Button
                      key={step}
                      size="sm"
                      variant={step === 'CANCELLED' ? 'danger' : 'secondary'}
                      loading={advance.isPending}
                      onClick={() => advance.mutate({ id: selected.id, to: step })}
                    >
                      Move to {step.replace(/_/g, ' ').toLowerCase()}
                    </Button>
                  ))}
                </div>
              </Card>

              <Submissions round={selected} scopeKey={key} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The legal next hops, mirroring the server's transition table. */
function nextSteps(status: string): string[] {
  const index = FUNNEL.indexOf(status);
  if (index === -1 || index === FUNNEL.length - 1) return [];
  return [FUNNEL[index + 1]!];
}

function Funnel({ status }: { status: string }) {
  const current = FUNNEL.indexOf(status);

  return (
    <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {FUNNEL.map((step, index) => (
        <li key={step} className="min-w-0 flex-1">
          <div
            className={`h-1 rounded-full ${
              index <= current && current !== -1 ? 'bg-primary' : 'bg-surface-raised'
            }`}
          />
          <p className="mt-1 truncate text-[10px] text-muted">
            {step.replace(/_/g, ' ').toLowerCase()}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Submissions({
  round,
  scopeKey,
}: {
  round: WeekendRoundView;
  scopeKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<AdminSubmission | null>(null);

  const submissions = useQuery({
    queryKey: [...scopeKey, round.id, 'submissions'],
    queryFn: () => api.get<AdminSubmission[]>(`/weekend/admin/${round.id}/submissions`),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [...scopeKey, round.id, 'submissions'] }),
      queryClient.invalidateQueries({ queryKey: scopeKey }),
    ]);

  const moderate = useMutation({
    mutationFn: ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: 'APPROVE' | 'REJECT';
      reason?: string;
    }) => api.post(`/weekend/admin/submissions/${id}/moderate`, { decision, reason }),
    onSuccess: async (_result, variables) => {
      toast.success(variables.decision === 'APPROVE' ? 'Entry approved' : 'Entry rejected');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not moderate that entry'),
  });

  const shortlist = useMutation({
    mutationFn: (ids: string[]) =>
      api.post(`/weekend/admin/${round.id}/shortlist`, { submissionIds: ids }),
    onSuccess: async () => {
      toast.success('Shortlist saved');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not shortlist those entries'),
  });

  const select = useMutation({
    mutationFn: (submissionId: string) =>
      api.post(`/weekend/admin/${round.id}/select`, { submissionId }),
    onSuccess: async () => {
      toast.success('Entry selected');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not select that entry'),
  });

  const [picked, setPicked] = useState<string[]>([]);

  if (submissions.isLoading) return <LoadingState rows={3} />;
  const rows = submissions.data ?? [];

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted">No entries in this round yet.</Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Entries ({rows.length})</h2>
        {picked.length > 0 && (
          <Button size="sm" loading={shortlist.isPending} onClick={() => shortlist.mutate(picked)}>
            Shortlist {picked.length}
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {rows.map((submission) => (
          <li
            key={submission.id}
            className="space-y-2 rounded-lg border border-border p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral" size="sm">
                    {submission.participationType.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  <StatusBadge status={submission.moderationStatus} />
                  {submission.shortlistedAt && (
                    <Badge tone="accent" size="sm">
                      shortlisted
                    </Badge>
                  )}
                </div>
                <p className="text-sm">{submission.content}</p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-1">
                {submission.moderationStatus !== 'APPROVED' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={moderate.isPending}
                    onClick={() => moderate.mutate({ id: submission.id, decision: 'APPROVE' })}
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    Approve
                  </Button>
                )}
                {submission.moderationStatus !== 'REJECTED' && (
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(submission)}>
                    <X className="h-4 w-4" aria-hidden />
                    Reject
                  </Button>
                )}
                {submission.moderationStatus === 'APPROVED' && !submission.shortlistedAt && (
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={picked.includes(submission.id)}
                      onChange={(event) =>
                        setPicked(
                          event.target.checked
                            ? [...picked, submission.id]
                            : picked.filter((id) => id !== submission.id),
                        )
                      }
                    />
                    shortlist
                  </label>
                )}
                {submission.shortlistedAt && (
                  <Button
                    size="sm"
                    loading={select.isPending}
                    onClick={() => select.mutate(submission.id)}
                  >
                    Select
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <RejectDialog
        submission={rejecting}
        pending={moderate.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (!rejecting) return;
          moderate.mutate(
            { id: rejecting.id, decision: 'REJECT', reason },
            { onSettled: () => setRejecting(null) },
          );
        }}
      />
    </Card>
  );
}

function RejectDialog({
  submission,
  pending,
  onClose,
  onConfirm,
}: {
  submission: AdminSubmission | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <ActionDialog
      open={submission !== null}
      title="Reject this entry?"
      description="The author is told, and the reason is what they see."
      confirmLabel="Reject"
      destructive
      pending={pending}
      disabled={reason.trim().length < 3}
      onClose={() => {
        setReason('');
        onClose();
      }}
      onConfirm={() => onConfirm(reason.trim())}
    >
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Reason</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-lg border border-border bg-surface-raised p-2 text-sm"
          placeholder="It named a person who has not consented to appear."
        />
      </label>
    </ActionDialog>
  );
}
