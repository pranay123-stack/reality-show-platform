'use client';

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  FormField,
  Input,
  StatusBadge,
  Textarea,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/admin/data-table';
import { DistributionBar, StatusPills } from '@/components/admin/primitives';
import { SectionHeader, useAdminMutation } from '@/components/admin/section-header';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface PollSummary {
  id: string;
  question: string;
  description: string | null;
  status: string;
  closesAt: string | null;
  totalVotes: number;
  version: number;
  options: { id: string; label: string; voteCount?: number }[];
  counts: { optionId: string; voteCount: number }[] | null;
}

type Scope = 'active' | 'past' | 'all';

/**
 * Live poll operations.
 *
 * Deliberately polls the list every ten seconds rather than opening a socket:
 * the operator view is a handful of numbers, and the realtime channel exists to
 * serve thousands of viewers, not to save an operator ten seconds of staleness.
 */
export function PollsSection() {
  const { can } = useAuth();
  const [scope, setScope] = useState<Scope>('all');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<{ poll: PollSummary; verb: string; label: string } | null>(
    null,
  );

  const key = queryKeys.admin.section('polls');
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<PollSummary[]>('/polls/admin/list'),
    refetchInterval: 10_000,
  });

  const act = useAdminMutation({
    key,
    fn: ({ id, verb }: { id: string; verb: string }) => api.post(`/polls/admin/${id}/${verb}`, {}),
    success: 'Poll updated',
  });

  if (!can('poll.create')) {
    return (
      <Alert tone="danger" title="Not available">
        Running live polls is a producer action.
      </Alert>
    );
  }

  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const all = list.data ?? [];
  const rows = all.filter((row) =>
    scope === 'all'
      ? true
      : scope === 'active'
        ? row.status === 'ACTIVE' || row.status === 'PAUSED'
        : row.status === 'CLOSED' || row.status === 'PUBLISHED',
  );

  const columns: Column<PollSummary>[] = [
    {
      key: 'question',
      header: 'Poll',
      render: (row) => (
        <button
          type="button"
          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
          className="min-w-0 text-left"
        >
          <span className="block truncate font-medium">{row.question}</span>
          <span className="block text-xs text-muted">{row.options.length} options</span>
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'votes',
      header: 'Votes',
      numeric: true,
      render: (row) => row.totalVotes.toLocaleString(),
    },
    {
      key: 'closes',
      header: 'Closes',
      secondary: true,
      render: (row) => (
        <span className="text-xs text-muted">
          {row.closesAt ? new Date(row.closesAt).toLocaleTimeString() : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          {row.status === 'DRAFT' && (
            <Button
              size="sm"
              onClick={() => setPending({ poll: row, verb: 'activate', label: 'Start' })}
            >
              Start
            </Button>
          )}
          {row.status === 'ACTIVE' && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPending({ poll: row, verb: 'pause', label: 'Pause' })}
              >
                Pause
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPending({ poll: row, verb: 'close', label: 'Close' })}
              >
                Close
              </Button>
            </>
          )}
          {row.status === 'PAUSED' && (
            <Button
              size="sm"
              onClick={() => setPending({ poll: row, verb: 'activate', label: 'Resume' })}
            >
              Resume
            </Button>
          )}
          {row.status === 'CLOSED' && can('poll.publish') && (
            <Button
              size="sm"
              onClick={() => setPending({ poll: row, verb: 'publish', label: 'Publish result' })}
            >
              Publish
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Live polls"
        description="Start, pause and close during the show. Results are published as a separate step."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New poll
          </Button>
        }
      />

      <StatusPills
        label="Poll scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'All', count: all.length },
          {
            value: 'active',
            label: 'Live',
            count: all.filter((poll) => poll.status === 'ACTIVE' || poll.status === 'PAUSED').length,
          },
          {
            value: 'past',
            label: 'Finished',
            count: all.filter((poll) => poll.status === 'CLOSED' || poll.status === 'PUBLISHED')
              .length,
          },
        ]}
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        expandedKey={expanded}
        emptyTitle="No polls"
        emptyDescription="Create one, then start it when the moment arrives."
        renderExpanded={(row) => <PollBreakdown poll={row} />}
        caption="Live polls with status and vote counts"
      />

      {creating && <PollForm scopeKey={key} onClose={() => setCreating(false)} />}

      <ConfirmDialog
        open={pending !== null}
        title={`${pending?.label ?? ''} this poll?`}
        description={pending?.poll.question}
        confirmLabel={pending?.label ?? 'Confirm'}
        destructive={pending?.verb === 'close'}
        pending={act.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          act.mutate({ id: pending.poll.id, verb: pending.verb }, { onSettled: () => setPending(null) });
        }}
      >
        {pending?.verb === 'close' && (
          <p className="text-sm text-muted">
            Closing stops voting immediately for everyone watching. The result stays hidden until
            you publish it.
          </p>
        )}
        {pending?.verb === 'publish' && (
          <p className="text-sm text-muted">
            Publishing reveals the full split to every viewer.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function PollBreakdown({ poll }: { poll: PollSummary }) {
  const counts = new Map((poll.counts ?? []).map((count) => [count.optionId, count.voteCount]));
  const known = poll.counts !== null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Votes</h3>
        {!known ? (
          <p className="text-sm text-muted">
            The split is withheld while the poll is live, so nobody can follow the crowd.
          </p>
        ) : (
          <DistributionBar
            total={poll.totalVotes}
            segments={poll.options.map((option) => ({
              key: option.id,
              label: option.label,
              value: counts.get(option.id) ?? 0,
            }))}
          />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Participation</h3>
        <dl className="space-y-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Total votes</dt>
            <dd className="font-medium tabular-nums">{poll.totalVotes.toLocaleString()}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Broadcast version</dt>
            <dd className="font-medium tabular-nums">{poll.version}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          The version increments on each broadcast frame; clients drop anything older, so a slow
          connection never shows a stale tally.
        </p>
      </div>
    </div>
  );
}

function PollForm({ scopeKey, onClose }: { scopeKey: readonly unknown[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(120);
  const [options, setOptions] = useState(['', '']);

  const create = useMutation({
    mutationFn: () =>
      api.post('/polls/admin', {
        question: question.trim(),
        description: description.trim() || null,
        durationSeconds,
        options: options
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label, index) => ({ label, sortOrder: index })),
      }),
    onSuccess: async () => {
      toast.success('Poll created as a draft');
      await queryClient.invalidateQueries({ queryKey: scopeKey });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create that poll'),
  });

  const filled = options.filter((option) => option.trim().length > 0);
  const ready = question.trim().length >= 5 && filled.length >= 2;

  return (
    <ConfirmDialog
      open
      title="New live poll"
      description="Created as a draft so you can start it on cue."
      confirmLabel="Create draft"
      pending={create.isPending}
      disabled={!ready}
      onClose={onClose}
      onConfirm={() => create.mutate()}
    >
      <div className="space-y-4">
        <FormField label="Question" htmlFor="poll-question">
          <Input
            id="poll-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Who should win tonight's task?"
          />
        </FormField>

        <FormField label="Description" htmlFor="poll-description">
          <Textarea
            id="poll-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        <FormField
          label="Voting window (seconds)"
          htmlFor="poll-duration"
          hint="Counts down from the moment you start it."
        >
          <Input
            id="poll-duration"
            type="number"
            min={10}
            max={3600}
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(Number(event.target.value))}
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Options</legend>
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={option}
                onChange={(event) => {
                  const next = [...options];
                  next[index] = event.target.value;
                  setOptions(next);
                }}
                placeholder={`Option ${index + 1}`}
                aria-label={`Option ${index + 1}`}
              />
              {options.length > 2 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <Button variant="ghost" size="sm" onClick={() => setOptions([...options, ''])}>
              <Plus className="h-4 w-4" aria-hidden />
              Add option
            </Button>
          )}
        </fieldset>

        <Card className="p-3">
          <p className="text-xs text-muted">
            While a poll is live the per-option split is sent only to people who have already voted.
          </p>
        </Card>
      </div>
    </ConfirmDialog>
  );
}
