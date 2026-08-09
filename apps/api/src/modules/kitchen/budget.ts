/**
 * Kitchen budget resolution.
 *
 * Pure and dependency-free so it can be reasoned about and unit-tested on its
 * own. Nothing here touches the database, the clock, or a request.
 *
 * The audience ranks options; this decides which of them the house can actually
 * be given, subject to three independent caps:
 *
 *   - `winnerCount`   — how many options the decision buys at all
 *   - `budgetUnits`   — what is left in the budget
 *   - `maxQuantity`   — a ceiling on total quantity, e.g. "no more than 8 kg"
 *
 * Greedy by popularity is the right rule here rather than a knapsack search:
 * the audience is expressing a preference order, and quietly buying a less
 * popular combination because it packs the budget better would misrepresent
 * what they voted for.
 */

export interface ResolvableOption {
  optionId: string;
  label: string;
  unitCost: number;
  quantity: number | null;
  unit: string | null;
  voteCount: number;
  /** Ranking score; equals voteCount unless the decision is weighted. */
  score: number;
  sortOrder: number;
}

export type SkipReason = 'BUDGET' | 'QUANTITY' | 'WINNER_LIMIT';

export interface ResolvedLine {
  optionId: string;
  label: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number;
  voteCount: number;
  percentage: number;
}

export interface ResolutionConfig {
  winnerCount: number;
  budgetUnits: number;
  maxQuantity: number | null;
}

export interface Resolution {
  selected: ResolvedLine[];
  skipped: (ResolvedLine & { reason: SkipReason })[];
  totalCost: number;
  totalQuantity: number;
  budgetRemainingAfter: number;
}

/** Deterministic ordering: score, then raw votes, then the producer's order. */
export function rankOptions(options: ResolvableOption[]): ResolvableOption[] {
  return [...options].sort(
    (a, b) =>
      b.score - a.score ||
      b.voteCount - a.voteCount ||
      a.sortOrder - b.sortOrder ||
      a.label.localeCompare(b.label),
  );
}

export function resolveSelection(
  options: ResolvableOption[],
  config: ResolutionConfig,
): Resolution {
  const totalVotes = options.reduce((sum, option) => sum + option.voteCount, 0);
  const toLine = (option: ResolvableOption): ResolvedLine => ({
    optionId: option.optionId,
    label: option.label,
    quantity: option.quantity,
    unit: option.unit,
    unitCost: option.unitCost,
    voteCount: option.voteCount,
    percentage: totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 1000) / 10 : 0,
  });

  const selected: ResolvedLine[] = [];
  const skipped: (ResolvedLine & { reason: SkipReason })[] = [];

  let totalCost = 0;
  let totalQuantity = 0;

  for (const option of rankOptions(options)) {
    // An option nobody voted for was not chosen; it is not "skipped for budget".
    if (option.voteCount === 0) continue;

    if (selected.length >= config.winnerCount) {
      skipped.push({ ...toLine(option), reason: 'WINNER_LIMIT' });
      continue;
    }

    if (totalCost + option.unitCost > config.budgetUnits) {
      skipped.push({ ...toLine(option), reason: 'BUDGET' });
      continue;
    }

    const quantity = option.quantity ?? 0;
    if (config.maxQuantity !== null && totalQuantity + quantity > config.maxQuantity) {
      skipped.push({ ...toLine(option), reason: 'QUANTITY' });
      continue;
    }

    selected.push(toLine(option));
    totalCost += option.unitCost;
    totalQuantity += quantity;
  }

  return {
    selected,
    skipped,
    totalCost,
    totalQuantity,
    budgetRemainingAfter: config.budgetUnits - totalCost,
  };
}

/** Cost of an explicit set of options, used when production records what it did. */
export function costOf(options: { unitCost: number }[]): number {
  return options.reduce((sum, option) => sum + option.unitCost, 0);
}

/** True when two selections contain exactly the same options. */
export function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
