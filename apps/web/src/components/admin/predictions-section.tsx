'use client';

import type { PredictionView } from '@reality/shared';
import { Alert, Button, Card, ErrorState, FormField, Input, Textarea } from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/admin/data-table';
import {
  ActionDialog,
  DistributionBar,
  StatusBadge,
  StatusPills,
} from '@/components/admin/primitives';
import { SectionHeader, useAdminMutation } from '@/components/admin/section-header';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

type Scope = 'open' | 'resolved' | 'all';

export function PredictionsSection() {
  const { can } = useAuth();
  const [scope, setScope] = useState<Scope>('all');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    prediction: PredictionView;
    verb: 'activate' | 'close' | 'cancel';
  } | null>(null);
  const [resolving, setResolving] = useState<PredictionView | null>(null);

  const key = queryKeys.admin.section('predictions');
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<PredictionView[]>('/predictions/admin/list'),
    refetchInterval: 30_000,
  });

  const act = useAdminMutation({
    key,
    fn: ({ id, verb }: { id: string; verb: string }) =>
      api.post(`/predictions/admin/${id}/${verb}`, {}),
    success: ({ verb }) => `Prediction ${verb}d`,
  });

  if (!can('prediction.create')) {
    return (
      <Alert tone="danger" title="Not available">
        Running the prediction game is a producer action.
      </Alert>
    );
  }

  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const all = list.data ?? [];
  const rows = all.filter((row) =>
    scope === 'all'
      ? true
      : scope === 'open'
        ? row.status === 'OPEN'
        : row.status === 'RESOLVED',
  );

  const columns: Column<PredictionView>[] = [
    {
      key: 'question',
      header: 'Prediction',
      render: (row) => (
        <button
          type="button"
          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
          className="min-w-0 text-left"
        >
          <span className="block truncate font-medium">{row.question}</span>
          <span className="block text-xs text-muted">
            {row.options.length} options · {row.rewardPoints} pts
          </span>
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'entries',
      header: 'Entries',
      numeric: true,
      render: (row) => row.entryCount.toLocaleString(),
    },
    {
      key: 'closes',
      header: 'Closes',
      secondary: true,
      render: (row) => (
        <span className="text-xs text-muted">{new Date(row.closesAt).toLocaleString()}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          {row.status === 'DRAFT' || row.status === 'SCHEDULED' ? (
            <Button size="sm" onClick={() => setPending({ prediction: row, verb: 'activate' })}>
              Open
            </Button>
          ) : null}
          {row.status === 'OPEN' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPending({ prediction: row, verb: 'close' })}
            >
              Close
            </Button>
          )}
          {(row.status === 'CLOSED' || row.status === 'OPEN') && can('prediction.resolve') && (
            <Button size="sm" onClick={() => setResolving(row)}>
              Resolve
            </Button>
          )}
          {row.status !== 'RESOLVED' && row.status !== 'CANCELLED' && can('prediction.cancel') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPending({ prediction: row, verb: 'cancel' })}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Predictions"
        description="Open, close and resolve. Resolving pays every correct entry through the points ledger."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New prediction
          </Button>
        }
      />

      <StatusPills
        label="Prediction scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'open', label: 'Open', count: all.filter((p) => p.status === 'OPEN').length },
          {
            value: 'resolved',
            label: 'Resolved',
            count: all.filter((p) => p.status === 'RESOLVED').length,
          },
        ]}
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        expandedKey={expanded}
        emptyTitle="No predictions"
        emptyDescription="Create one and open it before the moment it is about."
        renderExpanded={(row) => <Distribution prediction={row} />}
        caption="Predictions with status and entry counts"
      />

      {creating && <PredictionForm scopeKey={key} onClose={() => setCreating(false)} />}

      <ActionDialog
        open={pending !== null}
        title={`${pending?.verb === 'activate' ? 'Open' : pending?.verb === 'close' ? 'Close' : 'Cancel'} this prediction?`}
        description={pending?.prediction.question}
        confirmLabel="Confirm"
        destructive={pending?.verb === 'cancel'}
        pending={act.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          act.mutate(
            { id: pending.prediction.id, verb: pending.verb },
            { onSettled: () => setPending(null) },
          );
        }}
      >
        {pending?.verb === 'cancel' && (
          <p className="text-sm text-muted">
            Cancelling leaves entries in place but pays nobody. It cannot be undone.
          </p>
        )}
      </ActionDialog>

      {resolving && (
        <ResolveDialog prediction={resolving} scopeKey={key} onClose={() => setResolving(null)} />
      )}
    </div>
  );
}

function Distribution({ prediction }: { prediction: PredictionView }) {
  const total = prediction.options.reduce((sum, option) => sum + option.entryCount, 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Where the audience landed</h3>
        {total === 0 ? (
          <p className="text-sm text-muted">Nobody has predicted yet.</p>
        ) : (
          <DistributionBar
            total={total}
            segments={prediction.options.map((option) => ({
              key: option.id,
              label: option.label,
              value: option.entryCount,
            }))}
          />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Reward impact</h3>
        <dl className="space-y-1 text-sm">
          <Row label="Points per correct entry" value={prediction.rewardPoints} />
          <Row label="Entries" value={total} />
          <Row
            label="Maximum payout if all correct"
            value={total * prediction.rewardPoints}
          />
          {prediction.correctOptionId && (
            <Row
              label="Correct entries"
              value={
                prediction.options.find((option) => option.id === prediction.correctOptionId)
                  ?.entryCount ?? 0
              }
            />
          )}
        </dl>
        <p className="text-xs text-muted">
          Payouts go through the points ledger and are idempotent — resolving twice credits nobody
          twice.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}

function ResolveDialog({
  prediction,
  scopeKey,
  onClose,
}: {
  prediction: PredictionView;
  scopeKey: readonly unknown[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [optionId, setOptionId] = useState('');
  const [notes, setNotes] = useState('');

  const resolve = useMutation({
    mutationFn: () =>
      api.post<{ usersCredited: number }>(`/predictions/admin/${prediction.id}/resolve`, {
        correctOptionId: optionId,
        notes: notes.trim() || undefined,
      }),
    onSuccess: async (result) => {
      toast.success(`Resolved · ${result.usersCredited} people credited`);
      await queryClient.invalidateQueries({ queryKey: scopeKey });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not resolve that prediction'),
  });

  return (
    <ActionDialog
      open
      title="Resolve this prediction"
      description={prediction.question}
      confirmLabel="Resolve and pay out"
      pending={resolve.isPending}
      disabled={!optionId}
      onClose={onClose}
      onConfirm={() => resolve.mutate()}
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What actually happened?</legend>
          {prediction.options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="correct-option"
                value={option.id}
                checked={optionId === option.id}
                onChange={() => setOptionId(option.id)}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {option.entryCount} picked
              </span>
            </label>
          ))}
        </fieldset>

        <FormField label="Notes" htmlFor="resolve-notes" hint="Recorded on the audit row.">
          <Textarea
            id="resolve-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>

        <Alert tone="warning">
          Resolving credits every correct entry immediately and cannot be undone from here.
        </Alert>
      </div>
    </ActionDialog>
  );
}

function PredictionForm({
  scopeKey,
  onClose,
}: {
  scopeKey: readonly unknown[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [closesAt, setClosesAt] = useState(() => {
    const inAnHour = new Date(Date.now() + 3_600_000);
    inAnHour.setSeconds(0, 0);
    return inAnHour.toISOString().slice(0, 16);
  });
  const [rewardPoints, setRewardPoints] = useState(50);
  const [options, setOptions] = useState(['', '']);

  const create = useMutation({
    mutationFn: () =>
      api.post('/predictions/admin', {
        question: question.trim(),
        description: description.trim() || null,
        closesAt: new Date(closesAt).toISOString(),
        rewardPoints,
        options: options
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label, index) => ({ label, sortOrder: index })),
      }),
    onSuccess: async () => {
      toast.success('Prediction created as a draft');
      await queryClient.invalidateQueries({ queryKey: scopeKey });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create that prediction'),
  });

  const filled = options.filter((option) => option.trim().length > 0);
  const ready = question.trim().length >= 5 && filled.length >= 2 && Boolean(closesAt);

  return (
    <ActionDialog
      open
      title="New prediction"
      description="Created as a draft. Opening it is a separate step."
      confirmLabel="Create draft"
      pending={create.isPending}
      disabled={!ready}
      onClose={onClose}
      onConfirm={() => create.mutate()}
    >
      <div className="space-y-4">
        <FormField label="Question" htmlFor="p-question">
          <Input
            id="p-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Who will be nominated tonight?"
          />
        </FormField>

        <FormField label="Description" htmlFor="p-description">
          <Textarea
            id="p-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Closes at" htmlFor="p-closes">
            <Input
              id="p-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(event) => setClosesAt(event.target.value)}
            />
          </FormField>
          <FormField label="Points for a correct call" htmlFor="p-points">
            <Input
              id="p-points"
              type="number"
              min={0}
              max={1000}
              value={rewardPoints}
              onChange={(event) => setRewardPoints(Number(event.target.value))}
            />
          </FormField>
        </div>

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
          {options.length < 8 && (
            <Button variant="ghost" size="sm" onClick={() => setOptions([...options, ''])}>
              <Plus className="h-4 w-4" aria-hidden />
              Add option
            </Button>
          )}
        </fieldset>

        <Card className="p-3">
          <p className="text-xs text-muted">
            A prediction must close before the event it is about. The API refuses a close time in
            the past.
          </p>
        </Card>
      </div>
    </ActionDialog>
  );
}
