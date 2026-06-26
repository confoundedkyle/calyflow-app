// Pure helpers for recruiter fit-feedback (no server-only imports, so they're
// unit-testable). The async query lives in queries.ts.

export interface FeedbackRow {
  name: string | null;
  title?: string | null;
  reason?: string | null;
}

/**
 * Build the "# Recruiter feedback" prompt block injected into a Shortlist run so
 * the agent calibrates to the human verdicts — favouring profiles like the
 * accepted ones and avoiding the rejected patterns. Returns "" when there's no
 * feedback yet.
 */
export function formatFeedbackBlock(
  accepted: FeedbackRow[],
  rejected: FeedbackRow[],
): string {
  if (accepted.length === 0 && rejected.length === 0) return "";
  const lines = [
    "# Recruiter feedback on candidates so far",
    "The recruiter reviewed earlier candidates. Calibrate to this: prioritise " +
      "profiles like the ACCEPTED ones, and steer clear of the REJECTED patterns " +
      "(never re-source a rejected person).",
  ];
  if (accepted.length) {
    lines.push("", "Accepted (good fits):");
    for (const a of accepted) {
      lines.push(`- ${a.name ?? "Unnamed"}${a.title ? ` — ${a.title}` : ""}`);
    }
  }
  if (rejected.length) {
    lines.push("", "Rejected (not a fit):");
    for (const r of rejected) {
      lines.push(
        `- ${r.name ?? "Unnamed"}${r.reason ? ` — ${r.reason}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
