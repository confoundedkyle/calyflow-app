export const STALE_SHORTLIST_RUN_MS = 30 * 60 * 1000;

export const STALE_SHORTLIST_RUN_MESSAGE =
  "This sourcing run was marked failed automatically because it was still running after 30 minutes. Start a new run to continue sourcing.";

export function staleShortlistRunCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_SHORTLIST_RUN_MS);
}
