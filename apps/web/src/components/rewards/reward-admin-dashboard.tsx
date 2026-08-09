'use client';

import {
  REWARD_PHYSICAL_DISCLAIMER,
  type RedemptionState,
  type RedemptionView,
  type RewardView,
} from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalClose,
  ModalContent,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  type BadgeProps,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Package, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const STATUS_TONE: Record<string, BadgeProps['tone']> = {
  DRAFT: 'neutral',
  AVAILABLE: 'success',
  PAUSED: 'warning',
  RETIRED: 'danger',
};

const REDEMPTION_TONE: Record<RedemptionState, BadgeProps['tone']> = {
  REQUESTED: 'neutral',
  RESERVED: 'primary',
  APPROVED: 'accent',
  FULFILLED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

/**
 * Reward administration.
 *
 * The permission split is visible in the UI, not just enforced by the API: a
 * moderator sees the same data with no controls, a producer runs the catalogue,
 * and only an admin sees retire and force-cancel. Showing a button that is
 * going to 403 is its own kind of bug.
 */
export function RewardAdminDashboard() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'catalogue' | 'queue'>('catalogue');

  if (!can('reward.view')) {
    return (
      <Alert tone="danger" title="Not available">
        You do not have access to reward administration.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-display-md font-semibold">Reward administration</h1>
          <p className="text-muted">
            The catalogue, its stock, and every redemption waiting on a human.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList>
            <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
            <TabsTrigger value="queue">Redemptions</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {!can('reward.manage') && (
        <Alert tone="info" title="Read only">
          You can review rewards and redemptions. Changing them is a producer action.
        </Alert>
      )}

      {tab === 'catalogue' ? <CatalogueTab /> : <RedemptionQueue />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function useAdminInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('rewards') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.section('redemptions') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rewards.catalogue }),
    ]);
}

function CatalogueTab() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [authorising, setAuthorising] = useState<RewardView | null>(null);
  const [stocking, setStocking] = useState<RewardView | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.section('rewards'),
    queryFn: () => api.get<RewardView[]>('/rewards/admin/catalogue'),
  });

  if (isLoading) return <LoadingState rows={4} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const rewards = data ?? [];

  return (
    <div className="space-y-4">
      {can('reward.manage') && (
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          New reward
        </Button>
      )}

      {rewards.length === 0 ? (
        <EmptyState title="No rewards yet" description="Create one to start the catalogue." />
      ) : (
        <ul className="space-y-3">
          {rewards.map((reward) => (
            <li key={reward.id}>
              <CatalogueRow
                reward={reward}
                onAuthorise={() => setAuthorising(reward)}
                onStock={() => setStocking(reward)}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateRewardModal onClose={() => setCreating(false)} />}
      {authorising && (
        <AuthoriseModal reward={authorising} onClose={() => setAuthorising(null)} />
      )}
      {stocking && <AddInventoryModal reward={stocking} onClose={() => setStocking(null)} />}
    </div>
  );
}

function CatalogueRow({
  reward,
  onAuthorise,
  onStock,
}: {
  reward: RewardView;
  onAuthorise: () => void;
  onStock: () => void;
}) {
  const { can } = useAuth();
  const invalidate = useAdminInvalidation();

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      api.post<RewardView>(`/rewards/admin/${reward.id}/status`, { status }),
    onSuccess: async () => {
      toast.success('Reward updated');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update that reward'),
  });

  const retire = useMutation({
    mutationFn: () => api.post<RewardView>(`/rewards/admin/${reward.id}/retire`, {}),
    onSuccess: async () => {
      toast.success('Reward retired');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not retire that reward'),
  });

  const blocked = reward.requiresProductionApproval && !reward.authorised;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[reward.status] ?? 'neutral'} size="sm">
              {reward.status.toLowerCase()}
            </Badge>
            <Badge tone="neutral" size="sm">
              {reward.category.toLowerCase()}
            </Badge>
            {blocked && (
              <Badge tone="warning" size="sm">
                Needs authorisation
              </Badge>
            )}
          </div>
          <h3 className="truncate font-semibold">{reward.name}</h3>
          <p className="font-mono text-xs text-muted">{reward.code}</p>
        </div>

        <div className="shrink-0 space-y-1 text-right text-sm">
          <p className="font-medium tabular-nums">{reward.pointCost.toLocaleString()} pts</p>
          <p className="text-xs text-muted tabular-nums">
            {reward.inventory.unlimited
              ? 'Unlimited'
              : `${reward.inventory.remaining ?? 0} left · ${reward.inventory.reserved} held · ${reward.inventory.fulfilled} given`}
          </p>
        </div>
      </div>

      {blocked && (
        <Alert tone="warning" title="Not publishable yet">
          A {reward.category.toLowerCase()} reward is a real-world promise. It needs production
          authorisation before anyone can see it.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {can('reward.manage') && (
          <>
            <Button size="sm" variant="secondary" onClick={onStock}>
              <Package className="h-4 w-4" aria-hidden />
              Add stock
            </Button>

            {reward.status !== 'AVAILABLE' && reward.status !== 'RETIRED' && (
              <Button
                size="sm"
                loading={setStatus.isPending}
                disabled={blocked}
                onClick={() => setStatus.mutate('AVAILABLE')}
              >
                Publish
              </Button>
            )}

            {reward.status === 'AVAILABLE' && (
              <Button
                size="sm"
                variant="secondary"
                loading={setStatus.isPending}
                onClick={() => setStatus.mutate('PAUSED')}
              >
                Pause
              </Button>
            )}
          </>
        )}

        {can('reward.physical_authorise') && reward.requiresProductionApproval && (
          <Button size="sm" variant={blocked ? 'accent' : 'ghost'} onClick={onAuthorise}>
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {reward.authorised ? 'Authorisation' : 'Authorise'}
          </Button>
        )}

        {can('reward.retire') && reward.status !== 'RETIRED' && (
          <Button
            size="sm"
            variant="danger"
            loading={retire.isPending}
            onClick={() => retire.mutate()}
          >
            Retire
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function CreateRewardModal({ onClose }: { onClose: () => void }) {
  const invalidate = useAdminInvalidation();
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    category: 'DIGITAL',
    type: 'DIGITAL_BADGE',
    pointCost: 100,
    totalUnits: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<RewardView>('/rewards/admin', {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        type: form.type,
        pointCost: Number(form.pointCost),
        totalUnits: form.totalUnits === '' ? null : Number(form.totalUnits),
      }),
    onSuccess: async () => {
      toast.success('Reward created as a draft');
      await invalidate();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create that reward'),
  });

  const realWorld = form.category !== 'DIGITAL';

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title="New reward"
        description="Every reward is created as a draft. Publishing is a separate step."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost">Cancel</Button>
            </ModalClose>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              Create draft
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Code" htmlFor="code" hint="Upper-case letters, numbers, underscores.">
            <Input
              id="code"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="BADGE_SUPERFAN"
            />
          </FormField>

          <FormField label="Name" htmlFor="name">
            <Input
              id="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </FormField>

          <FormField label="Description" htmlFor="description">
            <Textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Category" htmlFor="category">
              <select
                id="category"
                className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm"
                value={form.category}
                onChange={(event) =>
                  setForm({
                    ...form,
                    category: event.target.value,
                    type: event.target.value === 'DIGITAL' ? 'DIGITAL_BADGE' : 'MERCH',
                  })
                }
              >
                <option value="DIGITAL">Digital</option>
                <option value="EXPERIENCE">Experience</option>
                <option value="PHYSICAL">Physical</option>
              </select>
            </FormField>

            <FormField label="Point cost" htmlFor="pointCost">
              <Input
                id="pointCost"
                type="number"
                min={0}
                value={form.pointCost}
                onChange={(event) => setForm({ ...form, pointCost: Number(event.target.value) })}
              />
            </FormField>
          </div>

          <FormField
            label="Stock"
            htmlFor="totalUnits"
            hint="Leave blank for unlimited — sensible for a badge, not for a hoodie."
          >
            <Input
              id="totalUnits"
              type="number"
              min={0}
              value={form.totalUnits}
              onChange={(event) => setForm({ ...form, totalUnits: event.target.value })}
            />
          </FormField>

          {realWorld && (
            <Alert tone="warning" title="This is a real-world promise">
              A {form.category.toLowerCase()} reward cannot be published until production authorises
              it, and every redemption will wait for a human.
            </Alert>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}

function AddInventoryModal({ reward, onClose }: { reward: RewardView; onClose: () => void }) {
  const invalidate = useAdminInvalidation();
  const [units, setUnits] = useState(10);

  const add = useMutation({
    mutationFn: () => api.post(`/rewards/admin/${reward.id}/inventory`, { units: Number(units) }),
    onSuccess: async () => {
      toast.success(`Added ${units} to ${reward.name}`);
      await invalidate();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not add stock'),
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title={`Add stock to ${reward.name}`}
        description="Stock is only ever added. Removing it would strip a unit somebody may already be holding."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost">Cancel</Button>
            </ModalClose>
            <Button loading={add.isPending} onClick={() => add.mutate()}>
              Add {units}
            </Button>
          </>
        }
      >
        <FormField label="Units to add" htmlFor="units">
          <Input
            id="units"
            type="number"
            min={1}
            value={units}
            onChange={(event) => setUnits(Number(event.target.value))}
          />
        </FormField>
      </ModalContent>
    </Modal>
  );
}

/**
 * Authorising a real-world reward.
 *
 * Two deliberate obstacles — a typed acknowledgement and a disclaimer — because
 * this is the same class of promise as an in-person weekend opportunity, and it
 * should not be possible to make one by clicking through a dialog.
 */
function AuthoriseModal({ reward, onClose }: { reward: RewardView; onClose: () => void }) {
  const invalidate = useAdminInvalidation();
  const [acknowledged, setAcknowledged] = useState(false);
  const [disclaimer, setDisclaimer] = useState(reward.disclaimer ?? REWARD_PHYSICAL_DISCLAIMER);

  const authorise = useMutation({
    mutationFn: (authorised: boolean) =>
      api.post<RewardView>(`/rewards/admin/${reward.id}/authorise`, {
        authorised,
        acknowledgeProductionAuthorisation: authorised ? acknowledged : undefined,
        disclaimer: authorised ? disclaimer : undefined,
      }),
    onSuccess: async (updated) => {
      toast.success(updated.authorised ? 'Authorised' : 'Authorisation withdrawn');
      await invalidate();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change authorisation'),
  });

  const ready = acknowledged && disclaimer.trim().length >= 20;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title={`Authorise ${reward.name}`}
        description="Confirms production can actually deliver this."
        footer={
          <>
            {reward.authorised ? (
              <Button
                variant="danger"
                loading={authorise.isPending}
                onClick={() => authorise.mutate(false)}
              >
                Withdraw authorisation
              </Button>
            ) : (
              <ModalClose asChild>
                <Button variant="ghost">Cancel</Button>
              </ModalClose>
            )}
            <Button
              disabled={!ready}
              loading={authorise.isPending}
              onClick={() => authorise.mutate(true)}
            >
              Authorise
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning" title="Do not promise what production cannot deliver">
            Authorising publishes a real-world commitment to the audience. Only do this once the
            item, the budget and the logistics are agreed.
          </Alert>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I confirm production has approved this reward and can fulfil every unit offered.
            </span>
          </label>

          <FormField
            label="Disclaimer shown to the audience"
            htmlFor="disclaimer"
            hint="At least 20 characters. Shown on the reward and on every redemption."
          >
            <Textarea
              id="disclaimer"
              rows={3}
              value={disclaimer}
              onChange={(event) => setDisclaimer(event.target.value)}
            />
          </FormField>
        </div>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Redemption queue
// ---------------------------------------------------------------------------

function RedemptionQueue() {
  const { can } = useAuth();
  const invalidate = useAdminInvalidation();
  const [rejecting, setRejecting] = useState<RedemptionView | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.section('redemptions'),
    queryFn: () => api.get<RedemptionView[]>('/rewards/admin/redemptions'),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'fulfil' | 'cancel' }) =>
      api.post<RedemptionView>(`/rewards/admin/redemptions/${id}/${action}`, {}),
    onSuccess: async () => {
      toast.success('Redemption updated');
      await invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update that redemption'),
  });

  if (isLoading) return <LoadingState rows={4} />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const redemptions = data ?? [];
  if (redemptions.length === 0) {
    return <EmptyState title="Nothing to fulfil" description="No redemptions are waiting." />;
  }

  return (
    <>
      <ul className="space-y-3">
        {redemptions.map((redemption) => {
          const open = ['REQUESTED', 'RESERVED', 'APPROVED'].includes(redemption.status);

          return (
            <li key={redemption.id}>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <Badge tone={REDEMPTION_TONE[redemption.status]} size="sm">
                      {redemption.status.toLowerCase()}
                    </Badge>
                    <h3 className="truncate font-semibold">{redemption.reward.name}</h3>
                    <p className="text-xs text-muted">
                      {new Date(redemption.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        'text-sm font-medium tabular-nums',
                        redemption.refunded && 'text-muted line-through',
                      )}
                    >
                      {redemption.pointsSpent.toLocaleString()} pts
                    </p>
                    {redemption.refunded && <p className="text-xs text-success">Refunded</p>}
                  </div>
                </div>

                {redemption.reward.disclaimer && (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {redemption.reward.disclaimer}
                  </p>
                )}

                {open && (
                  <div className="flex flex-wrap gap-2">
                    {can('reward.manage') && redemption.status === 'RESERVED' && (
                      <Button
                        size="sm"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: redemption.id, action: 'approve' })}
                      >
                        Approve
                      </Button>
                    )}

                    {can('reward.manage') && redemption.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: redemption.id, action: 'fulfil' })}
                      >
                        Mark fulfilled
                      </Button>
                    )}

                    {can('reward.manage') && (
                      <Button size="sm" variant="secondary" onClick={() => setRejecting(redemption)}>
                        Decline &amp; refund
                      </Button>
                    )}

                    {can('reward.force_cancel') && (
                      <Button
                        size="sm"
                        variant="danger"
                        loading={act.isPending}
                        onClick={() => act.mutate({ id: redemption.id, action: 'cancel' })}
                      >
                        Force cancel
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {rejecting && <RejectModal redemption={rejecting} onClose={() => setRejecting(null)} />}
    </>
  );
}

function RejectModal({
  redemption,
  onClose,
}: {
  redemption: RedemptionView;
  onClose: () => void;
}) {
  const invalidate = useAdminInvalidation();
  const [reason, setReason] = useState('');

  const reject = useMutation({
    mutationFn: () =>
      api.post<RedemptionView>(`/rewards/admin/redemptions/${redemption.id}/reject`, { reason }),
    onSuccess: async () => {
      toast.success('Declined — points returned');
      await invalidate();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not decline that redemption'),
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        title={`Decline ${redemption.reward.name}?`}
        description={`${redemption.pointsSpent.toLocaleString()} points go straight back to the viewer.`}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="ghost">Cancel</Button>
            </ModalClose>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={reject.isPending}
              onClick={() => reject.mutate()}
            >
              Decline and refund
            </Button>
          </>
        }
      >
        <FormField label="Reason" htmlFor="reason" hint="Recorded in the audit log.">
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Supplier could not fulfil this size."
          />
        </FormField>
      </ModalContent>
    </Modal>
  );
}
