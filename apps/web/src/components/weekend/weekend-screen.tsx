'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  WEEKEND_PARTICIPATION_TYPE_LABELS,
  weekendSubmissionSchema,
  type WeekendRoundView,
  type WeekendSubmissionInput,
} from '@reality/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Countdown,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  PageHeader,
  Textarea,
} from '@reality/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Gift, Info, Trophy } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { EligibilityPanel } from '@/components/weekend/eligibility-panel';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const FUNNEL = [
  { status: 'OPEN', label: 'Open' },
  { status: 'SUBMIT', label: 'Taking entries' },
  { status: 'MODERATION', label: 'Moderation' },
  { status: 'SHORTLIST', label: 'Shortlist' },
  { status: 'PRODUCER_SELECTION', label: 'Producer review' },
  { status: 'SELECTED', label: 'Selected' },
  { status: 'COMPLETED', label: 'Completed' },
];

export function WeekendScreen() {
  const { canParticipate } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.weekend.current,
    queryFn: () => api.get<WeekendRoundView | null>('/weekend/current'),
    refetchInterval: 60_000,
  });

  const submit = useMutation({
    mutationFn: ({ roundId, input }: { roundId: string; input: WeekendSubmissionInput }) =>
      api.post<{ pointsAwarded: number }>(`/weekend/${roundId}/submissions`, input),
    onSuccess: async (result) => {
      toast.success(
        result.pointsAwarded > 0
          ? `Entry sent for moderation · +${result.pointsAwarded} points`
          : 'Entry sent for moderation',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.weekend.current }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.me }),
      ]);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send your entry'),
  });

  // The header stays put through both: a page that blanks itself while loading
  // loses the reader's place, and every other screen keeps its title.
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Header />
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <Header />
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No weekend round open"
          description="A new round opens each week ahead of the weekend episode."
        />
      </div>
    );
  }

  const currentStep = FUNNEL.findIndex((step) => step.status === data.status);

  return (
    <div className="space-y-6">
      <Header />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <Badge tone={data.submissionsOpen ? 'live' : 'neutral'} size="sm">
              {data.submissionsOpen ? 'Taking entries' : data.status.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            <h2 className="text-lg font-semibold">{data.title}</h2>
            {data.description && <p className="text-sm text-muted">{data.description}</p>}
          </div>

          {data.submissionsOpen && (
            <div className="shrink-0 space-y-1 sm:text-right">
              <span className="flex items-center gap-1.5 text-sm">
                <CalendarClock className="h-4 w-4 text-muted" aria-hidden />
                <Countdown to={data.submissionDeadline} finishedLabel="Closed" />
              </span>
              <p className="text-xs text-muted tabular-nums">
                {data.totalSubmissions.toLocaleString()} entries so far
              </p>
            </div>
          )}
        </div>

        <ol className="flex flex-wrap gap-x-4 gap-y-1.5">
          {FUNNEL.map((step, index) => (
            <li key={step.status} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  index === currentStep
                    ? 'bg-primary'
                    : index < currentStep
                      ? 'bg-success'
                      : 'bg-border-strong',
                )}
              />
              <span
                className={
                  index === currentStep
                    ? 'font-medium'
                    : index < currentStep
                      ? 'text-muted'
                      : 'text-muted/60'
                }
              >
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {data.mySubmissions.length > 0 && <MySubmissions round={data} />}

          {data.submissionsOpen && data.availableTypes.length > 0 && (
            <SubmissionForm
              round={data}
              canParticipate={canParticipate && data.eligibility.eligible}
              isSubmitting={submit.isPending}
              onSubmit={(input) => submit.mutate({ roundId: data.id, input })}
            />
          )}

          {data.selections && data.selections.length > 0 && <Selections round={data} />}
        </div>

        <div className="space-y-6">
          <EligibilityPanel eligibility={data.eligibility} />
          <RewardsPanel round={data} />
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      title="Weekend Spotlight"
      description="Send something in for the weekend episode. Entries are moderated, shortlisted, then chosen by production."
    />
  );
}

function SubmissionForm({
  round,
  canParticipate,
  isSubmitting,
  onSubmit,
}: {
  round: WeekendRoundView;
  canParticipate: boolean;
  isSubmitting: boolean;
  onSubmit: (input: WeekendSubmissionInput) => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<WeekendSubmissionInput>({
    resolver: zodResolver(weekendSubmissionSchema),
    defaultValues: {
      participationType: round.availableTypes[0],
      questionId: null,
      content: '',
    },
  });

  const content = watch('content') ?? '';
  const selectedType = watch('participationType');
  const question = round.questions.find((candidate) => candidate.type === selectedType);
  const maxLength = question?.maxLength ?? 800;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send an entry</CardTitle>
        {question && <p className="text-sm text-muted">{question.prompt}</p>}
      </CardHeader>

      <CardContent>
        {!canParticipate ? (
          <Alert tone="warning" title="You cannot submit yet">
            Meet the requirements on the right, and confirm your email address, to take part.
          </Alert>
        ) : (
          <form
            onSubmit={handleSubmit((values) => {
              onSubmit({ ...values, questionId: question?.id ?? null });
              reset({ participationType: round.availableTypes[0], content: '', questionId: null });
            })}
            className="space-y-4"
            noValidate
          >
            <FormField
              label="Kind of entry"
              htmlFor="participationType"
              error={errors.participationType?.message}
              required
            >
              <select
                id="participationType"
                className="h-11 w-full rounded-md border border-border bg-input px-3.5 text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                {...register('participationType')}
              >
                {round.availableTypes.map((type) => (
                  <option key={type} value={type}>
                    {WEEKEND_PARTICIPATION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Your entry"
              htmlFor="content"
              error={errors.content?.message}
              hint={`${content.length}/${maxLength} characters`}
              required
            >
              <Textarea
                id="content"
                rows={5}
                maxLength={maxLength}
                placeholder="Write your question or idea here."
                {...register('content')}
              />
            </FormField>

            <p className="text-xs text-muted">
              Every entry is read by a moderator before production sees it.
            </p>

            <Button type="submit" loading={isSubmitting}>
              Send for moderation
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MySubmissions({ round }: { round: WeekendRoundView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your entries</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {round.mySubmissions.map((submission) => (
          <div
            key={submission.id}
            className="space-y-2 rounded-md border border-border bg-surface-raised p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm">
                {WEEKEND_PARTICIPATION_TYPE_LABELS[submission.participationType]}
              </Badge>
              <Badge
                tone={
                  submission.selected
                    ? 'success'
                    : submission.shortlisted
                      ? 'primary'
                      : submission.moderationOutcome === 'REJECTED'
                        ? 'danger'
                        : 'neutral'
                }
                size="sm"
              >
                {submission.selected
                  ? `Selected · position ${submission.selectionPosition}`
                  : submission.shortlisted
                    ? 'Shortlisted'
                    : submission.moderationOutcome === 'REJECTED'
                      ? 'Not approved'
                      : submission.moderationOutcome === 'APPROVED'
                        ? 'Approved'
                        : 'In moderation'}
              </Badge>
              {submission.completedAt && (
                <Badge tone="success" size="sm">
                  Used on the show
                </Badge>
              )}
            </div>

            <p className="text-sm">{submission.content}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Selections({ round }: { round: WeekendRoundView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-heat-3" aria-hidden />
          Chosen for the show
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {round.selections?.map((selection) => (
          <div key={selection.position} className="rounded-md border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="font-mono text-xs text-muted">#{selection.position}</span>
              {selection.displayName}
              {selection.completedAt && (
                <Badge tone="success" size="sm">
                  Aired
                </Badge>
              )}
            </p>
            <p className="mt-1 text-sm text-muted">{selection.content}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * What the round offers.
 *
 * The in-person line only appears when production has authorised it for this
 * specific round; the disclaimer is always shown alongside.
 */
function RewardsPanel({ round }: { round: WeekendRoundView }) {
  const { rewards } = round;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4 text-primary" aria-hidden />
          What you can win
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2.5 text-sm">
        <Row label="On-air recognition" value="Yes" />
        <Row label="For submitting" value={`+${rewards.pointsForSubmitting} points`} />
        <Row label="If shortlisted" value={`+${rewards.pointsForShortlist} points`} />
        <Row label="If selected" value={`+${rewards.pointsForSelection} points`} />

        {rewards.inPersonOpportunity && (
          <Row label="In-person opportunity" value="Authorised for this round" highlight />
        )}

        <p className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {rewards.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={cn('font-medium tabular-nums', highlight && 'text-success')}>{value}</span>
    </div>
  );
}
