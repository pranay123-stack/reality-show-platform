import { DEFAULT_HEAT_WEIGHTS } from '@reality/shared';
import { describe, expect, it } from 'vitest';

import {
  MOMENTUM_SATURATION,
  computeHeatScore,
  derivePeaks,
  type HeatInputs,
  type HeatPeaks,
} from '../heat.service.js';

const zeroInputs: HeatInputs = {
  audienceVotes: 0,
  reactions: 0,
  profileViews: 0,
  contentEngagement: 0,
  predictionActivity: 0,
  challengeActivity: 0,
  momentumDelta: 0,
};

const peaks: HeatPeaks = {
  audienceVotes: 100,
  reactions: 100,
  profileViews: 100,
  contentEngagement: 100,
  predictionActivity: 100,
  challengeActivity: 100,
};

describe('computeHeatScore', () => {
  it('stays within 0–100', () => {
    const floor = computeHeatScore({ ...zeroInputs, momentumDelta: -1000 }, peaks);
    const ceiling = computeHeatScore(
      {
        audienceVotes: 1e6,
        reactions: 1e6,
        profileViews: 1e6,
        contentEngagement: 1e6,
        predictionActivity: 1e6,
        challengeActivity: 1e6,
        momentumDelta: 1000,
      },
      peaks,
    );

    expect(floor.score).toBeGreaterThanOrEqual(0);
    expect(ceiling.score).toBeLessThanOrEqual(100);
    expect(ceiling.score).toBeGreaterThan(floor.score);
  });

  it('gives a contestant with every peak signal the top score', () => {
    const best = computeHeatScore(
      {
        audienceVotes: 100,
        reactions: 100,
        profileViews: 100,
        contentEngagement: 100,
        predictionActivity: 100,
        challengeActivity: 100,
        momentumDelta: MOMENTUM_SATURATION,
      },
      peaks,
    );
    expect(best.score).toBe(100);
  });

  it('is monotonic: more of a signal never lowers the score', () => {
    const low = computeHeatScore({ ...zeroInputs, audienceVotes: 10 }, peaks).score;
    const mid = computeHeatScore({ ...zeroInputs, audienceVotes: 50 }, peaks).score;
    const high = computeHeatScore({ ...zeroInputs, audienceVotes: 100 }, peaks).score;

    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('compresses the long tail so one runaway contestant does not flatten the rest', () => {
    // A contestant with 1% of the peak still scores well above zero on that
    // signal, because normalisation is sqrt-scaled rather than linear.
    const component = computeHeatScore({ ...zeroInputs, audienceVotes: 1 }, peaks).components.find(
      (item) => item.key === 'audienceVotes',
    )!;
    expect(component.normalized).toBeCloseTo(0.1, 2);
  });

  it('does not punish a contestant for being merely stable', () => {
    const flat = computeHeatScore({ ...zeroInputs, audienceVotes: 50 }, peaks);
    const falling = computeHeatScore(
      { ...zeroInputs, audienceVotes: 50, momentumDelta: -MOMENTUM_SATURATION },
      peaks,
    );
    const rising = computeHeatScore(
      { ...zeroInputs, audienceVotes: 50, momentumDelta: MOMENTUM_SATURATION },
      peaks,
    );

    expect(falling.score).toBeLessThan(flat.score);
    expect(rising.score).toBeGreaterThan(flat.score);
  });

  it('reports a trend that matches the momentum', () => {
    expect(computeHeatScore({ ...zeroInputs, momentumDelta: 5 }, peaks).trend).toBe('UP');
    expect(computeHeatScore({ ...zeroInputs, momentumDelta: -5 }, peaks).trend).toBe('DOWN');
    expect(computeHeatScore({ ...zeroInputs, momentumDelta: 0 }, peaks).trend).toBe('FLAT');
    // Noise below half a point is not a trend.
    expect(computeHeatScore({ ...zeroInputs, momentumDelta: 0.2 }, peaks).trend).toBe('FLAT');
  });

  it('returns a breakdown that reconstructs the score', () => {
    const result = computeHeatScore(
      {
        audienceVotes: 80,
        reactions: 40,
        profileViews: 60,
        contentEngagement: 20,
        predictionActivity: 10,
        challengeActivity: 5,
        momentumDelta: 2,
      },
      peaks,
    );

    const totalWeight = result.components.reduce((sum, component) => sum + component.weight, 0);
    const weighted = result.components.reduce((sum, component) => sum + component.contribution, 0);

    expect(result.score).toBeCloseTo((weighted / totalWeight) * 100, 1);
    expect(result.components).toHaveLength(7);
    expect(result.components.map((component) => component.key)).toContain('momentum');
  });

  it('handles an empty cohort without dividing by zero', () => {
    const emptyPeaks = derivePeaks([]);
    const result = computeHeatScore(zeroInputs, emptyPeaks);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('honours configured weights instead of the defaults', () => {
    const votesOnly = { ...DEFAULT_HEAT_WEIGHTS, audienceVotes: 1, reactions: 0, profileViews: 0, contentEngagement: 0, predictionActivity: 0, challengeActivity: 0, momentum: 0 };

    const scoredOnVotes = computeHeatScore({ ...zeroInputs, audienceVotes: 100 }, peaks, votesOnly);
    const scoredOnReactions = computeHeatScore({ ...zeroInputs, reactions: 100 }, peaks, votesOnly);

    expect(scoredOnVotes.score).toBe(100);
    expect(scoredOnReactions.score).toBe(0);
  });
});

describe('derivePeaks', () => {
  it('takes the maximum of each signal across the cohort', () => {
    const cohort: HeatInputs[] = [
      { ...zeroInputs, audienceVotes: 10, reactions: 90 },
      { ...zeroInputs, audienceVotes: 70, reactions: 20 },
      { ...zeroInputs, audienceVotes: 30, reactions: 50 },
    ];

    const derived = derivePeaks(cohort);
    expect(derived.audienceVotes).toBe(70);
    expect(derived.reactions).toBe(90);
    expect(derived.profileViews).toBe(0);
  });

  it('ranks a cohort sensibly end to end', () => {
    const cohort: HeatInputs[] = [
      { ...zeroInputs, audienceVotes: 100, reactions: 80, profileViews: 90 },
      { ...zeroInputs, audienceVotes: 50, reactions: 40, profileViews: 45 },
      { ...zeroInputs, audienceVotes: 5, reactions: 2, profileViews: 8 },
    ];

    const derived = derivePeaks(cohort);
    const scores = cohort.map((inputs) => computeHeatScore(inputs, derived).score);

    expect(scores[0]).toBeGreaterThan(scores[1]!);
    expect(scores[1]).toBeGreaterThan(scores[2]!);
  });
});
