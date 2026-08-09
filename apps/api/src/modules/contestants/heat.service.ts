import type { Prisma } from '@prisma/client';
import { DEFAULT_HEAT_WEIGHTS, HEAT_SCORE_MAX, HEAT_SCORE_MIN } from '@reality/shared';

import { prisma } from '../../core/prisma.js';

/**
 * ContestantHeatService — the Heat Meter.
 *
 * Heat measures **contestants on the show**. It is not a user score and never
 * mixes with the viewer leaderboard.
 *
 * The formula lives here and only here: the frontend receives a number and the
 * component breakdown, never the arithmetic. Weights come from show config with
 * `DEFAULT_HEAT_WEIGHTS` as the fallback, so production can retune without a
 * deploy.
 *
 * Scoring is *relative*: each raw signal is normalised against the strongest
 * contestant for that signal in the same run. Absolute vote counts vary wildly
 * between a quiet Tuesday and a finale, so an absolute scale would make heat
 * mean different things on different nights.
 */

export interface HeatInputs {
  audienceVotes: number;
  reactions: number;
  profileViews: number;
  contentEngagement: number;
  predictionActivity: number;
  challengeActivity: number;
  /** Change in score since the previous snapshot, in points. */
  momentumDelta: number;
}

export type HeatWeights = Record<keyof typeof DEFAULT_HEAT_WEIGHTS, number>;

export interface HeatComponent {
  key: keyof HeatWeights;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
}

export interface HeatComputation {
  score: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  components: HeatComponent[];
  weights: HeatWeights;
  peaks: Record<string, number>;
}

/** Peak value of each signal across the cohort, used to normalise. */
export interface HeatPeaks {
  audienceVotes: number;
  reactions: number;
  profileViews: number;
  contentEngagement: number;
  predictionActivity: number;
  challengeActivity: number;
}

const SIGNAL_KEYS = [
  'audienceVotes',
  'reactions',
  'profileViews',
  'contentEngagement',
  'predictionActivity',
  'challengeActivity',
] as const;

/** Momentum is a swing of at most this many points before it saturates. */
export const MOMENTUM_SATURATION = 15;

function normalize(value: number, peak: number): number {
  if (peak <= 0) return 0;
  // Square root compresses the long tail: one runaway contestant should not
  // flatten everybody else to zero.
  return Math.min(1, Math.sqrt(Math.max(0, value) / peak));
}

/**
 * Pure scoring function — no database, no clock. This is what the unit tests
 * exercise and what an admin sees a breakdown of.
 */
export function computeHeatScore(
  inputs: HeatInputs,
  peaks: HeatPeaks,
  weights: HeatWeights = DEFAULT_HEAT_WEIGHTS,
): HeatComputation {
  const components: HeatComponent[] = SIGNAL_KEYS.map((key) => {
    const raw = inputs[key];
    const normalized = normalize(raw, peaks[key]);
    const weight = weights[key];
    return { key, raw, normalized, weight, contribution: normalized * weight };
  });

  // Momentum is signed: -1 (falling hard) → 0.5 (flat) → 1 (rising hard), so a
  // contestant who is merely stable is not punished.
  const momentumNormalized =
    0.5 + clamp(inputs.momentumDelta / MOMENTUM_SATURATION, -1, 1) * 0.5;

  components.push({
    key: 'momentum',
    raw: inputs.momentumDelta,
    normalized: momentumNormalized,
    weight: weights.momentum,
    contribution: momentumNormalized * weights.momentum,
  });

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, component) => sum + component.contribution, 0);

  const score = clamp(
    totalWeight > 0 ? (weighted / totalWeight) * HEAT_SCORE_MAX : 0,
    HEAT_SCORE_MIN,
    HEAT_SCORE_MAX,
  );

  return {
    score: round2(score),
    trend: inputs.momentumDelta > 0.5 ? 'UP' : inputs.momentumDelta < -0.5 ? 'DOWN' : 'FLAT',
    components: components.map((component) => ({
      ...component,
      normalized: round4(component.normalized),
      contribution: round4(component.contribution),
    })),
    weights,
    peaks: { ...peaks },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Derives peaks from a cohort so callers never have to. */
export function derivePeaks(cohort: HeatInputs[]): HeatPeaks {
  const peaks: HeatPeaks = {
    audienceVotes: 0,
    reactions: 0,
    profileViews: 0,
    contentEngagement: 0,
    predictionActivity: 0,
    challengeActivity: 0,
  };
  for (const inputs of cohort) {
    for (const key of SIGNAL_KEYS) {
      if (inputs[key] > peaks[key]) peaks[key] = inputs[key];
    }
  }
  return peaks;
}

// ---------------------------------------------------------------------------
// Gathering (database side)
// ---------------------------------------------------------------------------

export async function getHeatWeights(showId: string): Promise<HeatWeights> {
  const show = await prisma.show.findUnique({ where: { id: showId }, select: { config: true } });
  const configured = (show?.config as { heatWeights?: Partial<HeatWeights> } | null)?.heatWeights;
  return { ...DEFAULT_HEAT_WEIGHTS, ...(configured ?? {}) };
}

/**
 * Collects every raw signal for one contestant over a window.
 *
 * Counters that the product increments directly (views, reactions) live in
 * `ContestantMetric`; participation signals are counted from the vote tables so
 * they cannot drift from reality.
 */
export async function gatherInputs(
  contestantId: string,
  since: Date,
  previousScore: number | null,
  currentScore: number,
): Promise<HeatInputs> {
  const [metrics, pollVotes, nominationVotes, evictionVotes, predictionEntries, challenges] =
    await Promise.all([
      prisma.contestantMetric.findMany({ where: { contestantId } }),
      prisma.pollVote.count({ where: { option: { contestantId }, createdAt: { gte: since } } }),
      prisma.nominationVote.count({ where: { contestantId, createdAt: { gte: since } } }),
      prisma.evictionVote.count({ where: { contestantId, createdAt: { gte: since } } }),
      prisma.predictionEntry.count({
        where: { option: { contestantId }, createdAt: { gte: since } },
      }),
      prisma.audienceChallenge.count({
        where: { targetContestantId: contestantId, createdAt: { gte: since }, deletedAt: null },
      }),
    ]);

  const metric = (key: string) => metrics.find((row) => row.metricKey === key)?.value ?? 0;

  return {
    audienceVotes: pollVotes + nominationVotes + evictionVotes,
    reactions: metric('reactions'),
    profileViews: metric('profileViews'),
    contentEngagement: metric('contentEngagement'),
    predictionActivity: predictionEntries,
    challengeActivity: challenges,
    momentumDelta: previousScore === null ? 0 : currentScore - previousScore,
  };
}

export interface RecomputeResult {
  contestantId: string;
  displayName: string;
  previousScore: number;
  score: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
}

/**
 * Recomputes heat for every active contestant in a show and appends a snapshot.
 *
 * Snapshots are append-only, which is what makes the 24h / 7d / season charts
 * and the admin's "why is this number what it is" view possible.
 */
export async function recomputeShowHeat(
  showId: string,
  options: { windowHours?: number } = {},
): Promise<RecomputeResult[]> {
  const windowHours = options.windowHours ?? 24;
  const since = new Date(Date.now() - windowHours * 3600_000);
  const weights = await getHeatWeights(showId);

  const contestants = await prisma.contestant.findMany({
    where: { showId, deletedAt: null },
    select: { id: true, displayName: true, heatScore: true },
  });
  if (contestants.length === 0) return [];

  const gathered = await Promise.all(
    contestants.map(async (contestant) => ({
      contestant,
      inputs: await gatherInputs(contestant.id, since, null, 0),
    })),
  );

  const peaks = derivePeaks(gathered.map((entry) => entry.inputs));

  const results: RecomputeResult[] = [];

  for (const { contestant, inputs } of gathered) {
    // First pass gives the raw standing; momentum then compares it with the
    // previous stored score. Computing momentum from the *new* raw score rather
    // than from itself avoids a feedback loop where heat chases its own tail.
    const provisional = computeHeatScore({ ...inputs, momentumDelta: 0 }, peaks, weights);
    const withMomentum = computeHeatScore(
      { ...inputs, momentumDelta: provisional.score - contestant.heatScore },
      peaks,
      weights,
    );

    await prisma.$transaction([
      prisma.contestantHeatSnapshot.create({
        data: {
          contestantId: contestant.id,
          heatScore: withMomentum.score,
          trend: withMomentum.trend,
          // Stored verbatim so an operator can reproduce the number later.
          inputs: {
            raw: { ...inputs },
            components: withMomentum.components,
            weights: withMomentum.weights,
            peaks: withMomentum.peaks,
            windowHours,
            previousScore: contestant.heatScore,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.contestant.update({
        where: { id: contestant.id },
        data: {
          heatScore: withMomentum.score,
          heatTrend: withMomentum.trend,
          heatUpdatedAt: new Date(),
        },
      }),
    ]);

    results.push({
      contestantId: contestant.id,
      displayName: contestant.displayName,
      previousScore: contestant.heatScore,
      score: withMomentum.score,
      trend: withMomentum.trend,
    });
  }

  return results;
}

/**
 * Admin view: the most recent snapshot with its full input breakdown, so an
 * operator can answer "why is this contestant at 78?" without reading code.
 */
export async function inspectHeat(contestantId: string) {
  const [contestant, snapshot] = await Promise.all([
    prisma.contestant.findUnique({
      where: { id: contestantId },
      select: { id: true, displayName: true, heatScore: true, heatTrend: true, heatUpdatedAt: true, showId: true },
    }),
    prisma.contestantHeatSnapshot.findFirst({
      where: { contestantId },
      orderBy: { computedAt: 'desc' },
    }),
  ]);

  if (!contestant) return null;

  return {
    contestant,
    weights: await getHeatWeights(contestant.showId),
    latestSnapshot: snapshot
      ? {
          id: snapshot.id,
          heatScore: snapshot.heatScore,
          trend: snapshot.trend,
          computedAt: snapshot.computedAt.toISOString(),
          inputs: snapshot.inputs,
        }
      : null,
  };
}
