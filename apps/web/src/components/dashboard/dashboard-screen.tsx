'use client';

import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Countdown,
  ErrorState,
  HeatBadge,
  LiveIndicator,
  LoadingState,
  PageHeader,
  StatCard,
} from '@reality/ui';
import { Activity, ArrowRight, Flame, Sparkles, Trophy } from 'lucide-react';
import Link from 'next/link';

import { useDashboard, type DashboardSummary } from '@/hooks/use-dashboard';
import { NAV_GROUPS } from '@/lib/navigation';
import { useAuth } from '@/providers/auth-provider';

/**
 * The dashboard is a *composition* of independent widgets, all fed by one
 * `/dashboard` payload. Feature modules plug in by adding an entry to
 * `FEATURE_CARDS` and a key to the API's `modules` object — no layout surgery.
 */
export function DashboardScreen() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-surface-raised" />
        <LoadingState rows={2} />
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={user ? `Welcome back, ${user.displayName}` : 'Dashboard'}
        description="Everything happening on the show right now."
      />

      {user && !user.emailVerified && (
        <Alert tone="warning" title="Confirm your email to take part">
          <Link href="/verify-email">Send yourself a new confirmation link</Link> — voting and
          predictions unlock once your address is confirmed.
        </Alert>
      )}

      <LiveBanner data={data} />
      <StatsRow data={data} />

      <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <FeatureGrid data={data} />
        <HottestContestants data={data} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LiveBanner({ data }: { data: DashboardSummary }) {
  const { live, modules } = data;

  // Whichever deadline lands first is the one worth putting a clock on.
  const nextDeadline = [
    modules.polls.nextCloseAt,
    modules.predictions.nextCloseAt,
    modules.nominations.closesAt,
    modules.kitchen.closesAt,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return (
    <Card className="relative overflow-hidden p-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-stage opacity-50" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <LiveIndicator live={live.isLive} />

          <h2 className="truncate text-lg font-semibold">
            {live.episode
              ? `Episode ${live.episode.number} — ${live.episode.title}`
              : live.show.name}
          </h2>

          {live.currentEvent ? (
            <p className="text-sm text-muted">
              <Badge size="sm" className="mr-2">
                {live.currentEvent.type.toLowerCase()}
              </Badge>
              {live.currentEvent.title}
            </p>
          ) : (
            <p className="text-sm text-muted">{live.show.tagline}</p>
          )}
        </div>

        {nextDeadline && (
          <div className="shrink-0 space-y-1.5 sm:text-right">
            <p className="text-xs uppercase tracking-widest text-muted">Next deadline</p>
            <Countdown to={nextDeadline} variant="blocks" finishedLabel="Closing now" />
          </div>
        )}
      </div>
    </Card>
  );
}

function StatsRow({ data }: { data: DashboardSummary }) {
  const { points, activity, leaderboard } = data;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Your points"
        value={points.balance}
        hint={points.earnedToday > 0 ? undefined : 'No points yet today'}
        icon={<Sparkles className="h-4 w-4" aria-hidden />}
        trend={
          points.earnedToday > 0
            ? { direction: 'up', value: `+${points.earnedToday} today` }
            : undefined
        }
      />
      <StatCard
        label="Leaderboard"
        value={leaderboard.rank ? `#${leaderboard.rank}` : '—'}
        hint={`of ${leaderboard.totalPlayers.toLocaleString()} players`}
        icon={<Trophy className="h-4 w-4" aria-hidden />}
      />
      <StatCard
        label="Actions today"
        value={activity.actionsToday}
        hint={activity.actionsToday === 0 ? 'Take part to start earning' : 'Keep it going'}
        icon={<Activity className="h-4 w-4" aria-hidden />}
      />
      <StatCard
        label="Lifetime points"
        value={points.lifetime}
        hint={activity.streak > 0 ? `${activity.streak}-day streak` : undefined}
        icon={<Flame className="h-4 w-4" aria-hidden />}
      />
    </div>
  );
}

interface FeatureCardConfig {
  href: string;
  title: string;
  describe: (data: DashboardSummary) => { line: string; badge?: string; urgent?: boolean };
}

const FEATURE_CARDS: FeatureCardConfig[] = [
  {
    href: '/predictions',
    title: 'Make Your Prediction',
    describe: ({ modules }) => ({
      line:
        modules.predictions.open === 0
          ? 'No predictions open right now'
          : `${modules.predictions.open} open · ${modules.predictions.awaitingYou} waiting for you`,
      badge: modules.predictions.awaitingYou ? `${modules.predictions.awaitingYou}` : undefined,
      urgent: modules.predictions.awaitingYou > 0,
    }),
  },
  {
    href: '/challenges',
    title: 'Change The House',
    describe: ({ modules }) => ({
      line:
        modules.challenges.votingOpen === 0
          ? 'No challenges in community voting'
          : `${modules.challenges.votingOpen} in community voting`,
      badge: modules.challenges.yoursInFlight ? `${modules.challenges.yoursInFlight} yours` : undefined,
    }),
  },
  {
    href: '/contestants',
    title: 'House Heat',
    describe: ({ hottestContestants }) => ({
      line: hottestContestants[0]
        ? `${hottestContestants[0].displayName} is hottest right now`
        : 'Heat scores update continuously',
    }),
  },
  {
    href: '/perspectives',
    title: 'Pick A Side',
    describe: ({ modules }) => ({
      line:
        modules.perspectives.open === 0
          ? 'No events open for comment'
          : `${modules.perspectives.open} open · ${modules.perspectives.awaitingYou} waiting for you`,
      badge: modules.perspectives.awaitingYou ? `${modules.perspectives.awaitingYou}` : undefined,
    }),
  },
  {
    href: '/polls',
    title: 'Live Polls',
    describe: ({ modules }) => ({
      line:
        modules.polls.active === 0
          ? 'No poll running'
          : `${modules.polls.active} live · ${modules.polls.awaitingYou} to vote on`,
      badge: modules.polls.active ? 'Live' : undefined,
      urgent: modules.polls.awaitingYou > 0,
    }),
  },
  {
    href: '/nominations',
    title: 'Nomination Night',
    describe: ({ modules }) => {
      if (modules.nominations.open) {
        return {
          line: `Nominations open · ${modules.nominations.votesUsed}/${modules.nominations.voteLimit} votes used`,
          badge: 'Open',
          urgent: modules.nominations.votesUsed < modules.nominations.voteLimit,
        };
      }
      if (modules.evictions.open) {
        return {
          line: `Eviction round open · ${modules.evictions.votesUsed}/${modules.evictions.voteLimit} votes used`,
          badge: 'Open',
          urgent: modules.evictions.votesUsed < modules.evictions.voteLimit,
        };
      }
      return { line: 'No round open right now' };
    },
  },
  {
    href: '/kitchen',
    title: 'Kitchen Battle',
    describe: ({ modules, live }) => ({
      line:
        modules.kitchen.open === 0
          ? 'No kitchen decision open'
          : `${modules.kitchen.open} decision${modules.kitchen.open === 1 ? '' : 's'} open · ${live.show.currencySymbol}${(modules.kitchen.budgetRemaining ?? 0).toLocaleString()} left`,
      badge: modules.kitchen.open ? 'Open' : undefined,
    }),
  },
  {
    href: '/weekend',
    title: 'Weekend Spotlight',
    describe: ({ modules }) => ({
      line: !modules.weekend.open
        ? 'Nothing open this week'
        : modules.weekend.submitted
          ? 'Your entry is in — watch for the shortlist'
          : 'Submissions are open',
      badge: modules.weekend.open && !modules.weekend.submitted ? 'Open' : undefined,
    }),
  },
];

function FeatureGrid({ data }: { data: DashboardSummary }) {
  return (
    <section aria-labelledby="ways-to-play" className="space-y-3">
      <h2 id="ways-to-play" className="text-sm font-semibold uppercase tracking-widest text-muted">
        Ways to play
      </h2>

      <ul className="grid gap-4 sm:grid-cols-2">
        {FEATURE_CARDS.map((card) => {
          const state = card.describe(data);
          const icon = NAV_GROUPS.flatMap((group) => group.items).find(
            (item) => item.href === card.href,
          )?.icon;
          const Icon = icon;

          return (
            <li key={card.href}>
              <Link href={card.href} className="block h-full focus-visible:outline-none">
                <Card
                  className={cn(
                    'h-full p-4 transition-colors hover:border-border-strong',
                    state.urgent && 'border-primary/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold">
                      {Icon && <Icon className="h-4 w-4 text-primary" aria-hidden />}
                      {card.title}
                    </span>
                    {state.badge && (
                      <Badge tone={state.urgent ? 'primary' : 'neutral'} size="sm">
                        {state.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted">{state.line}</p>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HottestContestants({ data }: { data: DashboardSummary }) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted">
          Hottest right now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.hottestContestants.map((contestant, index) => (
          <Link
            key={contestant.id}
            href={`/contestants/${contestant.id}`}
            className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-4 text-center font-mono text-xs text-muted tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {contestant.displayName}
            </span>
            <HeatBadge score={contestant.heatScore} trend={contestant.heatTrend} showLabel={false} />
          </Link>
        ))}

        {data.hottestContestants.length === 0 && (
          <p className="text-sm text-muted">No contestants yet.</p>
        )}

        <Link
          href="/contestants"
          className="mt-1 inline-flex h-9 items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          See the full heat meter
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
