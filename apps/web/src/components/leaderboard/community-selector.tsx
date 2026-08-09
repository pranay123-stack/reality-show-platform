'use client';

import type { CommunityView } from '@reality/shared';
import { Badge, Button, EmptyState, LoadingState, cn } from '@reality/ui';
import { Lock, Users } from 'lucide-react';

import { useCommunities, useJoinCommunity } from '@/hooks/use-leaderboard';

export interface CommunitySelectorProps {
  selectedId: string | null;
  onSelect: (communityId: string) => void;
}

/**
 * Picks which community's ranking to show.
 *
 * The type label comes from the server rather than a hardcoded list, because
 * community types are rows: a producer can add "college" or "creator community"
 * without this component changing.
 */
export function CommunitySelector({ selectedId, onSelect }: CommunitySelectorProps) {
  const { data, isLoading } = useCommunities();
  const join = useJoinCommunity();

  if (isLoading) return <LoadingState rows={2} />;

  const communities = data ?? [];
  if (communities.length === 0) {
    return (
      <EmptyState
        title="No communities yet"
        description="Communities are set up by production — city groups, campuses, creator audiences."
        icon={<Users className="h-6 w-6" aria-hidden />}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label="Communities"
      >
        {communities.map((community) => (
          <button
            key={community.id}
            type="button"
            role="tab"
            aria-selected={selectedId === community.id}
            onClick={() => onSelect(community.id)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
              selectedId === community.id
                ? 'border-primary/50 bg-primary/15 text-foreground'
                : 'border-border text-muted hover:border-border-strong hover:text-foreground',
            )}
          >
            {community.isPrivate && <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="max-w-[12rem] truncate">{community.name}</span>
            <span className="text-xs tabular-nums opacity-70">{community.memberCount}</span>
          </button>
        ))}
      </div>

      <SelectedCommunityBar
        community={communities.find((entry) => entry.id === selectedId) ?? null}
        onToggle={(id, joined) => join.mutate({ id, join: !joined })}
        pending={join.isPending}
      />
    </div>
  );
}

function SelectedCommunityBar({
  community,
  onToggle,
  pending,
}: {
  community: CommunityView | null;
  onToggle: (id: string, joined: boolean) => void;
  pending: boolean;
}) {
  if (!community) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" size="sm">
            {community.type.label}
          </Badge>
          {community.joined && (
            <Badge tone="success" size="sm">
              Member
            </Badge>
          )}
        </div>
        {community.description && (
          <p className="truncate text-xs text-muted">{community.description}</p>
        )}
      </div>

      {/* An invitation-only community cannot be joined from here on purpose. */}
      {community.isPrivate && !community.joined ? (
        <span className="text-xs text-muted">Invitation only</span>
      ) : (
        <Button
          size="sm"
          variant={community.joined ? 'ghost' : 'secondary'}
          loading={pending}
          onClick={() => onToggle(community.id, community.joined)}
        >
          {community.joined ? 'Leave' : 'Join'}
        </Button>
      )}
    </div>
  );
}
