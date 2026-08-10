'use client';

import type { KitchenDecisionView } from '@reality/shared';
import { Alert, Button, Card, ErrorState, FormField, Input, Textarea } from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/admin/data-table';
import { ActionDialog, DistributionBar, StatusBadge } from '@/components/admin/primitives';
import { SectionHeader, useAdminMutation } from '@/components/admin/section-header';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

export function KitchenSection() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [budgeting, setBudgeting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    decision: KitchenDecisionView;
    verb: string;
    label: string;
    note?: string;
  } | null>(null);

  const key = queryKeys.admin.section('kitchen');
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<KitchenDecisionView[]>('/kitchen/admin/list'),
    refetchInterval: 20_000,
  });

  const act = useAdminMutation({
    key,
    fn: ({ id, verb }: { id: string; verb: string }) => api.post(`/kitchen/admin/${id}/${verb}`, {}),
    success: 'Decision updated',
  });

  if (!can('kitchen.manage')) {
    return (
      <Alert tone="danger" title="Not available">
        Kitchen control is a producer action.
      </Alert>
    );
  }

  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const rows = list.data ?? [];

  const columns: Column<KitchenDecisionView>[] = [
    {
      key: 'title',
      header: 'Decision',
      render: (row) => (
        <button
          type="button"
          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
          className="min-w-0 text-left"
        >
          <span className="block truncate font-medium">{row.title}</span>
          <span className="block text-xs text-muted">
            {row.options.length} options · pick {row.winnerCount}
          </span>
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
      key: 'budget',
      header: 'Budget left',
      numeric: true,
      secondary: true,
      render: (row) => row.budget.remainingUnits,
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          {row.status === 'DRAFT' && (
            <Button size="sm" onClick={() => setPending({ decision: row, verb: 'open', label: 'Open' })}>
              Open
            </Button>
          )}
          {row.status === 'OPEN' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPending({ decision: row, verb: 'close', label: 'Close' })}
            >
              Close
            </Button>
          )}
          {row.status === 'CLOSED' && (
            <Button
              size="sm"
              onClick={() =>
                setPending({
                  decision: row,
                  verb: 'publish-audience-result',
                  label: 'Publish audience result',
                  note: 'This publishes what the audience chose. It is not a promise that the house will cook it.',
                })
              }
            >
              Publish audience result
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Kitchen control"
        description="The audience decision and what the house actually does are recorded separately."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setBudgeting(true)}>
              <Wallet className="h-4 w-4" aria-hidden />
              Set budget
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New decision
            </Button>
          </div>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        expandedKey={expanded}
        emptyTitle="No kitchen decisions"
        emptyDescription="Create one and open it for voting."
        renderExpanded={(row) => <KitchenBreakdown decision={row} />}
        caption="Kitchen decisions with status, votes and remaining budget"
      />

      {creating && <DecisionForm scopeKey={key} onClose={() => setCreating(false)} />}
      {budgeting && <BudgetForm scopeKey={key} onClose={() => setBudgeting(false)} />}

      <ActionDialog
        open={pending !== null}
        title={`${pending?.label ?? ''}?`}
        description={pending?.decision.title}
        confirmLabel={pending?.label ?? 'Confirm'}
        pending={act.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          act.mutate(
            { id: pending.decision.id, verb: pending.verb },
            { onSettled: () => setPending(null) },
          );
        }}
      >
        {pending?.note && <p className="text-sm text-muted">{pending.note}</p>}
      </ActionDialog>
    </div>
  );
}

function KitchenBreakdown({ decision }: { decision: KitchenDecisionView }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Votes</h3>
        <DistributionBar
          total={decision.totalVotes}
          segments={decision.options.map((option) => ({
            key: option.id,
            label: `${option.label}${option.unitCost ? ` (${option.unitCost})` : ''}`,
            value: option.voteCount,
          }))}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Result</h3>
        {decision.audienceResult ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted">
              Audience chose{' '}
              <span className="font-medium text-foreground">
                {decision.audienceResult.selected.map((line) => line.label).join(', ') || '—'}
              </span>
            </p>
            {decision.audienceResult.skipped.length > 0 && (
              <p className="text-xs text-warning">
                Skipped:{' '}
                {decision.audienceResult.skipped
                  .map((line) => `${line.label} (${line.reason.toLowerCase()})`)
                  .join(', ')}
              </p>
            )}
            <p className="text-muted">
              Implemented:{' '}
              <span className="font-medium text-foreground">
                {decision.implementedResult
                  ? decision.implementedResult.selected.map((line) => line.label).join(', ')
                  : 'not yet decided by production'}
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No result published yet.</p>
        )}
        <p className="text-xs text-muted">
          Budget is only spent by the implementation, never by the audience vote.
        </p>
      </div>
    </div>
  );
}

function DecisionForm({ scopeKey, onClose }: { scopeKey: readonly unknown[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    description: '',
    kind: 'MENU',
    winnerCount: 1,
    maxSelections: 1,
    closesAt: new Date(Date.now() + 7_200_000).toISOString().slice(0, 16),
  });
  const [options, setOptions] = useState([
    { label: '', unitCost: 1 },
    { label: '', unitCost: 1 },
  ]);

  const create = useMutation({
    mutationFn: () =>
      api.post('/kitchen/admin', {
        title: form.title.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        winnerCount: form.winnerCount,
        maxSelections: form.maxSelections,
        closesAt: new Date(form.closesAt).toISOString(),
        options: options
          .filter((option) => option.label.trim())
          .map((option, index) => ({
            label: option.label.trim(),
            unitCost: option.unitCost,
            sortOrder: index,
          })),
      }),
    onSuccess: async () => {
      toast.success('Decision created as a draft');
      await queryClient.invalidateQueries({ queryKey: scopeKey });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create that decision'),
  });

  const ready =
    form.title.trim().length >= 3 && options.filter((option) => option.label.trim()).length >= 2;

  return (
    <ActionDialog
      open
      title="New kitchen decision"
      confirmLabel="Create draft"
      pending={create.isPending}
      disabled={!ready}
      onClose={onClose}
      onConfirm={() => create.mutate()}
    >
      <div className="space-y-4">
        <FormField label="Title" htmlFor="k-title">
          <Input
            id="k-title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="What should the house cook on Friday?"
          />
        </FormField>

        <FormField label="Description" htmlFor="k-description">
          <Textarea
            id="k-description"
            rows={2}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Kind" htmlFor="k-kind">
            <select
              id="k-kind"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
              className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm"
            >
              {['MENU', 'QUANTITY', 'INGREDIENT', 'SPECIAL'].map((kind) => (
                <option key={kind} value={kind}>
                  {kind.toLowerCase()}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Closes at" htmlFor="k-closes">
            <Input
              id="k-closes"
              type="datetime-local"
              value={form.closesAt}
              onChange={(event) => setForm({ ...form, closesAt: event.target.value })}
            />
          </FormField>
          <FormField label="Winners" htmlFor="k-winners" hint="How many options are carried out.">
            <Input
              id="k-winners"
              type="number"
              min={1}
              max={5}
              value={form.winnerCount}
              onChange={(event) => setForm({ ...form, winnerCount: Number(event.target.value) })}
            />
          </FormField>
          <FormField label="Picks per person" htmlFor="k-picks">
            <Input
              id="k-picks"
              type="number"
              min={1}
              max={5}
              value={form.maxSelections}
              onChange={(event) => setForm({ ...form, maxSelections: Number(event.target.value) })}
            />
          </FormField>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Options and their cost</legend>
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={option.label}
                onChange={(event) => {
                  const next = [...options];
                  next[index] = { ...next[index]!, label: event.target.value };
                  setOptions(next);
                }}
                placeholder={`Option ${index + 1}`}
                aria-label={`Option ${index + 1} label`}
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={option.unitCost}
                onChange={(event) => {
                  const next = [...options];
                  next[index] = { ...next[index]!, unitCost: Number(event.target.value) };
                  setOptions(next);
                }}
                className="w-20 shrink-0"
                aria-label={`Option ${index + 1} cost`}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOptions([...options, { label: '', unitCost: 1 }])}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add option
            </Button>
          )}
        </fieldset>
      </div>
    </ActionDialog>
  );
}

function BudgetForm({ scopeKey, onClose }: { scopeKey: readonly unknown[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [totalUnits, setTotalUnits] = useState(20);
  const [label, setLabel] = useState('This week');

  const save = useMutation({
    mutationFn: () =>
      api.post('/kitchen/admin/budgets', { totalUnits, label: label.trim() || undefined }),
    onSuccess: async () => {
      toast.success('Budget set');
      await queryClient.invalidateQueries({ queryKey: scopeKey });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not set that budget'),
  });

  return (
    <ActionDialog
      open
      title="Set the kitchen budget"
      description="Options cost units. The budget is only spent when production implements a result."
      confirmLabel="Set budget"
      pending={save.isPending}
      onClose={onClose}
      onConfirm={() => save.mutate()}
    >
      <div className="space-y-4">
        <FormField label="Label" htmlFor="b-label">
          <Input id="b-label" value={label} onChange={(event) => setLabel(event.target.value)} />
        </FormField>
        <FormField label="Total units" htmlFor="b-units">
          <Input
            id="b-units"
            type="number"
            min={1}
            max={1000}
            value={totalUnits}
            onChange={(event) => setTotalUnits(Number(event.target.value))}
          />
        </FormField>
        <Card className="p-3">
          <p className="text-xs text-muted">
            An audience choice that exceeds the remaining budget is reported as skipped rather than
            silently dropped.
          </p>
        </Card>
      </div>
    </ActionDialog>
  );
}
