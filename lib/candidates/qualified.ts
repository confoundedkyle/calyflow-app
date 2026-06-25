// Pure helpers for candidate qualification (no server-only imports, so they're
// unit testable).

import type { CandidateStatus } from "../types";

// Score at/above which a candidate counts as "qualified" when the agent doesn't
// say so explicitly. The agent normally sets `qualified` from the criteria.
export const QUALIFIED_SCORE_THRESHOLD = 70;

/** Whether a candidate with this score/flag should count toward the goal. An
 *  explicit boolean wins; otherwise derive from the score and threshold. */
export function deriveQualified(
  score: number | null | undefined,
  explicit: boolean | null | undefined,
): boolean {
  if (typeof explicit === "boolean") return explicit;
  if (typeof score === "number") return score >= QUALIFIED_SCORE_THRESHOLD;
  return false;
}

/** Default pipeline status when the agent doesn't set one. */
export function deriveStatus(
  status: CandidateStatus | null | undefined,
  qualified: boolean,
): CandidateStatus {
  if (status) return status;
  return qualified ? "qualified" : "sourced";
}
