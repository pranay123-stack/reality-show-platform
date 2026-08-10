'use client';

import type { AuditEntryView, AuditFacetsView, AuditFeedView } from '@reality/shared';
import { Alert, Badge, Button, Card, ErrorState, LoadingState, cn } from '@reality/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Lock } from 'lucide-react';
import { useState } from 'react';

import { FilterBar, SelectFilter } from '@/components/admin/primitives';
import { SectionHeader } from '@/components/admin/section-header';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface Filters {
  module: string;
  action: string;
  actorId: string;
  entityType: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { module: '', action: '', actorId: '', entityType: '', from: '', to: '' };

/**
 * The audit log.
 *
 * Read-only, and visibly so: there is no edit control anywhere on this screen
 * because the trail is append-only in the database. An operator who could amend
 * the record of their own actions would make the record worthless.
 */
export function AuditSection() {
  const { can } = useAuth();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [expanded, setExpanded] = useState<string | null>(null);

  const facets = useQuery({
    queryKey: queryKeys.admin.section('audit-facets'),
    queryFn: () => api.get<AuditFacetsView>('/admin/audit/facets'),
    enabled: can('audit.view'),
    staleTime: 300_000,
  });

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    // The date inputs give a local day; the API wants an instant.
    if (key === 'from') query.set('from', new Date(`${value}T00:00:00`).toISOString());
    else if (key === 'to') {
      const end = new Date(`${value}T00:00:00`);
      end.setDate(end.getDate() + 1);
      query.set('to', end.toISOString());
    } else query.set(key, value);
  }

  const logs = useQuery({
    queryKey: queryKeys.admin.section('audit', filters),
    queryFn: () => api.get<AuditFeedView>(`/admin/audit?${query.toString()}`),
    enabled: can('audit.view'),
  });

  if (!can('audit.view')) {
    return (
      <Alert tone="danger" title="Not available">
        The audit trail is visible to administrators only.
      </Alert>
    );
  }

  const active = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Audit log"
        description="Every operator action, as it was recorded. Append-only and never edited."
      />

      <FilterBar>
        <SelectFilter
          label="Module"
          value={filters.module}
          options={(facets.data?.modules ?? []).map((module) => ({ value: module, label: module }))}
          onChange={(module) => setFilters({ ...filters, module, action: '' })}
        />
        <SelectFilter
          label="Action"
          value={filters.action}
          options={(facets.data?.actions ?? [])
            .filter((action) => !filters.module || action.startsWith(`${filters.module}.`))
            .map((action) => ({ value: action, label: action }))}
          onChange={(action) => setFilters({ ...filters, action })}
        />
        <SelectFilter
          label="Actor"
          value={filters.actorId}
          options={(facets.data?.actors ?? []).map((actor) => ({
            value: actor.id,
            label: `${actor.displayName} (${actor.role.toLowerCase()})`,
          }))}
          onChange={(actorId) => setFilters({ ...filters, actorId })}
        />
        <SelectFilter
          label="Target type"
          value={filters.entityType}
          options={(facets.data?.entityTypes ?? []).map((type) => ({ value: type, label: type }))}
          onChange={(entityType) => setFilters({ ...filters, entityType })}
        />

        <div className="space-y-1">
          <label htmlFor="audit-from" className="block text-xs text-muted">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="audit-to" className="block text-xs text-muted">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>

        {active && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
            Clear
          </Button>
        )}
      </FilterBar>

      {logs.isError ? (
        <ErrorState onRetry={() => void logs.refetch()} />
      ) : logs.isLoading ? (
        <LoadingState rows={6} />
      ) : (logs.data?.items.length ?? 0) === 0 ? (
        <Card className="p-8 text-center">
          <Lock className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium">Nothing matches</p>
          <p className="text-xs text-muted">
            {active ? 'Try widening the filters.' : 'No operator actions have been recorded yet.'}
          </p>
        </Card>
      ) : (
        <>
          <ul className="space-y-2">
            {logs.data!.items.map((entry) => (
              <li key={entry.id}>
                <AuditRow
                  entry={entry}
                  expanded={expanded === entry.id}
                  onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                />
              </li>
            ))}
          </ul>

          {logs.data!.hasMore && (
            <p className="text-center text-xs text-muted">
              Showing the most recent {logs.data!.items.length}. Narrow the filters to see further
              back.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const ROLE_TONE: Record<string, 'danger' | 'accent' | 'primary' | 'neutral'> = {
  ADMIN: 'danger',
  PRODUCER: 'accent',
  MODERATOR: 'primary',
  USER: 'neutral',
};

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntryView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = entry.before !== null || entry.after !== null;

  return (
    <Card className={cn('overflow-hidden p-0', expanded && 'border-primary/30')}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDetail}
        className={cn(
          'flex w-full items-start gap-3 p-3 text-left',
          hasDetail && 'hover:bg-surface-raised',
        )}
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{entry.action}</span>
            <Badge tone="neutral" size="sm">
              {entry.module}
            </Badge>
            {entry.actorRole && (
              <Badge tone={ROLE_TONE[entry.actorRole] ?? 'neutral'} size="sm">
                {entry.actorRole.toLowerCase()}
              </Badge>
            )}
          </span>

          <span className="block text-xs text-muted">
            {entry.actor?.displayName ?? 'system'} · {entry.entityType}
            {entry.entityId && (
              <span className="font-mono"> {entry.entityId.slice(0, 12)}…</span>
            )}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-xs text-muted">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
          {hasDetail && (
            <ChevronDown
              className={cn(
                'ml-auto mt-1 h-4 w-4 text-muted transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          )}
        </span>
      </button>

      {expanded && hasDetail && (
        <div className="grid gap-3 border-t border-border bg-surface-raised/50 p-3 md:grid-cols-2">
          <JsonPanel label="Before" value={entry.before} />
          <JsonPanel label="After" value={entry.after} />
          {entry.requestId && (
            <p className="col-span-full font-mono text-[11px] text-muted">
              request {entry.requestId}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function JsonPanel({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="text-xs text-muted/70">not recorded</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted">{label}</p>
      {/* Bounded and scrollable: an audit payload can be arbitrarily large. */}
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
