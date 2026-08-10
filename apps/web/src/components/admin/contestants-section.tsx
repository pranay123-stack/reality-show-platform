'use client';

import { CONTESTANT_STATUSES, type ContestantStatus } from '@reality/shared';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ErrorState,
  FormField,
  Input,
  Textarea,
  cn,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/admin/data-table';
import { ActionDialog, StatusBadge } from '@/components/admin/primitives';
import { SectionHeader, useAdminMutation } from '@/components/admin/section-header';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface AdminContestant {
  id: string;
  slug: string;
  displayName: string;
  tagline: string | null;
  avatarUrl: string | null;
  occupation: string | null;
  hometown: string | null;
  age: number | null;
  status: ContestantStatus;
  heatScore: number;
  heatTrend: string;
  heatUpdatedAt: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  engagement: {
    predictionOptions: number;
    perspectiveOptions: number;
    events: number;
    heatSnapshots: number;
  };
}

export function ContestantsSection() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminContestant | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    contestant: AdminContestant;
    status: ContestantStatus;
  } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useQuery({
    queryKey: queryKeys.admin.section('contestants'),
    queryFn: () => api.get<AdminContestant[]>('/contestants/admin/list'),
  });

  const setStatus = useAdminMutation({
    key: queryKeys.admin.section('contestants'),
    fn: ({ id, status }: { id: string; status: ContestantStatus }) =>
      api.post(`/contestants/admin/${id}/status`, { status }),
    success: 'Contestant updated',
  });

  if (!can('contestant.manage')) {
    return (
      <Alert tone="danger" title="Not available">
        Managing contestants is a producer action.
      </Alert>
    );
  }

  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];

  const columns: Column<AdminContestant>[] = [
    {
      key: 'name',
      header: 'Contestant',
      render: (row) => (
        <button
          type="button"
          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
          className="flex items-center gap-3 text-left"
        >
          <Avatar name={row.displayName} src={row.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.displayName}</span>
            <span className="block truncate text-xs text-muted">
              {row.tagline ?? row.occupation ?? row.slug}
            </span>
          </span>
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'heat',
      header: 'Heat',
      numeric: true,
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <Flame
            className={cn(
              'h-3.5 w-3.5',
              row.heatScore >= 70 ? 'text-heat-3' : row.heatScore >= 40 ? 'text-heat-4' : 'text-muted',
            )}
            aria-hidden
          />
          {row.heatScore.toFixed(1)}
        </span>
      ),
    },
    {
      key: 'engagement',
      header: 'Appearances',
      numeric: true,
      secondary: true,
      render: (row) => row.engagement.events + row.engagement.predictionOptions,
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
            Edit
          </Button>
          <select
            aria-label={`Set status for ${row.displayName}`}
            value=""
            onChange={(event) => {
              const status = event.target.value as ContestantStatus;
              if (status) setStatusTarget({ contestant: row, status });
              event.target.value = '';
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">Status…</option>
            {CONTESTANT_STATUSES.filter((status) => status !== row.status).map((status) => (
              <option key={status} value={status}>
                {status.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Contestants"
        description="Heat is measured from audience signals, never typed in."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add contestant
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        expandedKey={expanded}
        emptyTitle="No contestants yet"
        emptyDescription="Add the cast and the heat meter starts measuring them."
        renderExpanded={(row) => <EngagementPanel contestant={row} />}
        caption="Contestants with their status and heat"
      />

      {creating && <ContestantForm onClose={() => setCreating(false)} />}
      {editing && <ContestantForm contestant={editing} onClose={() => setEditing(null)} />}

      <ActionDialog
        open={statusTarget !== null}
        title={`Mark ${statusTarget?.contestant.displayName ?? ''} as ${statusTarget?.status.toLowerCase() ?? ''}?`}
        description={
          statusTarget?.status === 'EVICTED' || statusTarget?.status === 'WINNER'
            ? 'This records an exit date. Their votes, heat history and past results are kept.'
            : 'This changes how they appear across the platform.'
        }
        confirmLabel="Change status"
        destructive={statusTarget?.status === 'EVICTED'}
        pending={setStatus.isPending}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => {
          if (!statusTarget) return;
          setStatus.mutate(
            { id: statusTarget.contestant.id, status: statusTarget.status },
            { onSettled: () => setStatusTarget(null) },
          );
        }}
      />
    </div>
  );
}

function EngagementPanel({ contestant }: { contestant: AdminContestant }) {
  const heat = useQuery({
    queryKey: queryKeys.contestants.heat(contestant.id, 'inspect'),
    queryFn: () => api.get<Record<string, unknown>>(`/contestants/${contestant.id}/heat/inspect`),
    retry: false,
  });

  const components = (heat.data?.components ?? []) as {
    key: string;
    label: string;
    raw: number;
    normalised: number;
    weight: number;
    contribution: number;
  }[];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Engagement</h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['Show events', contestant.engagement.events],
            ['Prediction options', contestant.engagement.predictionOptions],
            ['Perspective options', contestant.engagement.perspectiveOptions],
            ['Heat snapshots', contestant.engagement.heatSnapshots],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-medium tabular-nums">{String(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          Entered {contestant.enteredAt ? new Date(contestant.enteredAt).toLocaleDateString() : '—'}
          {contestant.exitedAt && ` · left ${new Date(contestant.exitedAt).toLocaleDateString()}`}
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">How the heat was computed</h3>
        {heat.isLoading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : components.length === 0 ? (
          <p className="text-xs text-muted">No heat inputs recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {components.map((component) => (
              <li key={component.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-muted">{component.label}</span>
                <span className="shrink-0 tabular-nums">
                  {component.contribution.toFixed(1)}
                  <span className="ml-1 text-xs text-muted">
                    ({Math.round(component.weight * 100)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ContestantForm({
  contestant,
  onClose,
}: {
  contestant?: AdminContestant;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = Boolean(contestant);

  const [form, setForm] = useState({
    displayName: contestant?.displayName ?? '',
    slug: contestant?.slug ?? '',
    tagline: contestant?.tagline ?? '',
    bio: '',
    occupation: contestant?.occupation ?? '',
    hometown: contestant?.hometown ?? '',
    age: contestant?.age ? String(contestant.age) : '',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        displayName: form.displayName.trim(),
        tagline: form.tagline.trim() || null,
        bio: form.bio.trim() || null,
        occupation: form.occupation.trim() || null,
        hometown: form.hometown.trim() || null,
        age: form.age ? Number(form.age) : null,
      };
      return editing
        ? api.patch(`/contestants/admin/${contestant!.id}`, payload)
        : api.post('/contestants/admin', { ...payload, slug: form.slug.trim() });
    },
    onSuccess: async () => {
      toast.success(editing ? 'Contestant updated' : 'Contestant added');
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('contestants') });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save that contestant'),
  });

  const ready = form.displayName.trim().length >= 2 && (editing || /^[a-z0-9-]{2,}$/.test(form.slug));

  return (
    <ActionDialog
      open
      title={editing ? `Edit ${contestant!.displayName}` : 'Add a contestant'}
      confirmLabel={editing ? 'Save changes' : 'Add contestant'}
      pending={save.isPending}
      disabled={!ready}
      onClose={onClose}
      onConfirm={() => save.mutate()}
    >
      <div className="space-y-4">
        <FormField label="Display name" htmlFor="c-name">
          <Input
            id="c-name"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          />
        </FormField>

        {!editing && (
          <FormField
            label="Slug"
            htmlFor="c-slug"
            hint="Used in their public URL. It cannot be changed later, because links break."
          >
            <Input
              id="c-slug"
              value={form.slug}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value.toLowerCase().replace(/\s+/g, '-') })
              }
              placeholder="aria-vale"
            />
          </FormField>
        )}

        <FormField label="Tagline" htmlFor="c-tagline">
          <Input
            id="c-tagline"
            value={form.tagline}
            onChange={(event) => setForm({ ...form, tagline: event.target.value })}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Occupation" htmlFor="c-occupation">
            <Input
              id="c-occupation"
              value={form.occupation}
              onChange={(event) => setForm({ ...form, occupation: event.target.value })}
            />
          </FormField>
          <FormField label="Hometown" htmlFor="c-hometown">
            <Input
              id="c-hometown"
              value={form.hometown}
              onChange={(event) => setForm({ ...form, hometown: event.target.value })}
            />
          </FormField>
          <FormField label="Age" htmlFor="c-age">
            <Input
              id="c-age"
              type="number"
              min={16}
              max={120}
              value={form.age}
              onChange={(event) => setForm({ ...form, age: event.target.value })}
            />
          </FormField>
        </div>

        <FormField label="Bio" htmlFor="c-bio">
          <Textarea
            id="c-bio"
            rows={3}
            value={form.bio}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
          />
        </FormField>

        <Card className="p-3">
          <p className="text-xs text-muted">
            Heat is not settable. It is computed from votes, predictions, perspectives and profile
            views, so it stays a measurement rather than an opinion.
          </p>
        </Card>
      </div>
    </ActionDialog>
  );
}
