import "server-only";
import { db } from "../db";
import type { Candidate } from "../types";

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
