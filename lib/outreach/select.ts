// Pure eligibility selection for outreach (no server-only imports, so it's
// unit-testable). Only candidates with a real email can be emailed.

import type { Candidate, OutreachDraftStatus } from "../types";

/** The email providers outreach can send from. */
export const EMAIL_PROVIDERS = ["gmail", "microsoft-outlook"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export function isEmailProvider(p: string): p is EmailProvider {
  return (EMAIL_PROVIDERS as readonly string[]).includes(p);
}

/** Whether a draft can be sent: not already sent or rejected, and it has a
 *  recipient. A 'failed' draft can be retried. Pure → unit-testable. */
export function canSendDraft(
  status: OutreachDraftStatus,
  toEmail: string | null,
): boolean {
  if (!toEmail?.trim()) return false;
  return status === "draft" || status === "failed";
}

/** True when the candidate has a usable email address. */
export function hasEmail(c: Pick<Candidate, "email">): boolean {
  return !!c.email?.trim();
}

/**
 * Pick the candidates to draft outreach for: those the recruiter marked
 * ✓ accepted (Fit) that have an email; if none were fit-reviewed, fall back to
 * the qualified ones with an email. Candidates without an email are never
 * eligible (we can't send to them).
 */
export function selectOutreachCandidates(candidates: Candidate[]): Candidate[] {
  const withEmail = candidates.filter(hasEmail);
  const accepted = withEmail.filter((c) => c.feedback === "accepted");
  if (accepted.length > 0) return accepted;
  return withEmail.filter((c) => c.qualified);
}
