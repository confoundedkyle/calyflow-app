import "server-only";
import { db } from "../db";
import type { Candidate } from "../types";
import type { FeedbackRow } from "./feedback";

/** All candidates for a project, best (highest score) first. */
export async function listCandidates(
  projectId: string,
): Promise<Candidate[]> {
  const { data, error } = await db()
    .from("candidates")
    .select("*")
    .eq("project_id", projectId)
    .order("score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Candidate[];
}

/** Count of qualified candidates in a project (the Shortlist goal metric). */
export async function countQualified(projectId: string): Promise<number> {
  const { count, error } = await db()
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("qualified", true);
  if (error) throw error;
  return count ?? 0;
}

/** Recruiter fit verdicts for a project, split into accepted / rejected with
 *  reasons — assembled into the run's feedback block so the agent calibrates. */
export async function listCandidateFeedback(
  projectId: string,
): Promise<{ accepted: FeedbackRow[]; rejected: FeedbackRow[] }> {
  const { data, error } = await db()
    .from("candidates")
    .select("name, raw, feedback, feedback_reason")
    .eq("project_id", projectId)
    .not("feedback", "is", null);
  if (error) throw error;
  const accepted: FeedbackRow[] = [];
  const rejected: FeedbackRow[] = [];
  for (const row of data ?? []) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title : null;
    if (row.feedback === "accepted") {
      accepted.push({ name: row.name as string | null, title });
    } else if (row.feedback === "rejected") {
      rejected.push({
        name: row.name as string | null,
        reason: (row.feedback_reason as string | null) ?? null,
      });
    }
  }
  return { accepted, rejected };
}

/** A compact view of already-stored candidates, for the agent to dedupe and
 *  resume against without pulling full payloads. */
export async function listCandidatesCompact(
  projectId: string,
  limit = 500,
): Promise<
  { name: string | null; email: string | null; linkedin: string | null; score: number | null; qualified: boolean }[]
> {
  const { data, error } = await db()
    .from("candidates")
    .select("name, email, linkedin, score, qualified")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as {
    name: string | null;
    email: string | null;
    linkedin: string | null;
    score: number | null;
    qualified: boolean;
  }[];
}
