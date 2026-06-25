// Pure budget math for the Shortlist (no server-only imports, so it's unit
// testable). The budget is set in USD — the same unit AI run costs are tracked
// in — so there's no currency conversion.

/** Whether cumulative USD spend has reached the USD budget. A null/zero/negative
 *  budget means "no budget set" → never reached. */
export function budgetReached(
  spentUsd: number,
  budgetUsd: number | null,
): boolean {
  if (budgetUsd == null || budgetUsd <= 0) return false;
  return spentUsd >= budgetUsd;
}
