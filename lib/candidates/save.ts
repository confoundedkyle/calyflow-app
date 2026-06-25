import "server-only";
import { db } from "../db";
import type { Candidate, CandidateStatus } from "../types";
import { deriveQualified, deriveStatus } from "./qualified";

export interface SaveCandidateInput {
  workspaceId: string;
  projectId: string;
  userId: string;
  name?: string | null;
  email?: string | null;
  linkedin?: string | null;
  source?: string | null;
  score?: number | null;
  qualified?: boolean | null;
  status?: CandidateStatus | null;
  /** Ad-hoc per-source fields stored in the `raw` JSONB column. */
  fields?: Record<string, unknown> | null;
}

/** Find an existing candidate in the project that matches by email or linkedin
 *  (case-insensitive), for dedupe. Returns the row or null. */
async function findExisting(
  projectId: string,
  email?: string | null,
  linkedin?: string | null,
): Promise<Candidate | null> {
  if (email?.trim()) {
    const { data } = await db()
      .from("candidates")
      .select("*")
      .eq("project_id", projectId)
      .ilike("email", email.trim())
      .limit(1)
      .maybeSingle();
    if (data) return data as Candidate;
  }
  if (linkedin?.trim()) {
    const { data } = await db()
      .from("candidates")
      .select("*")
      .eq("project_id", projectId)
      .ilike("linkedin", linkedin.trim())
      .limit(1)
      .maybeSingle();
    if (data) return data as Candidate;
  }
  return null;
}

/** Archive the raw candidate payload as a JSON file in the documents bucket,
 *  under {workspace}/project/{project}/candidates/{id}.json. Best-effort: a
 *  failure here never blocks the row write. Returns the storage path or null. */
async function archiveJson(
  workspaceId: string,
  projectId: string,
  id: string,
  payload: unknown,
): Promise<string | null> {
  const path = `${workspaceId}/project/${projectId}/candidates/${id}.json`;
  try {
    const { error } = await db()
      .storage.from("documents")
      .upload(path, JSON.stringify(payload, null, 2), {
        contentType: "application/json",
        upsert: true,
      });
    if (error) {
      console.warn("Candidate JSON archive failed:", error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.warn("Candidate JSON archive threw:", err);
    return null;
  }
}

export interface SaveCandidateResult {
  id: string;
  deduped: boolean;
  qualified: boolean;
}

/**
 * Upsert a sourced candidate. Dedupes within the project by email/linkedin: an
 * existing match is updated (raw fields merged, score/qualified/status
 * refreshed), otherwise a new row is inserted. The raw payload is archived as a
 * JSON file in the bucket.
 */
export async function saveCandidate(
  input: SaveCandidateInput,
): Promise<SaveCandidateResult> {
  const fields = input.fields ?? {};
  const qualified = deriveQualified(input.score, input.qualified);
  const status = deriveStatus(input.status, qualified);

  const existing = await findExisting(
    input.projectId,
    input.email,
    input.linkedin,
  );

  if (existing) {
    const mergedRaw = { ...(existing.raw ?? {}), ...fields };
    const { error } = await db()
      .from("candidates")
      .update({
        name: input.name ?? existing.name,
        email: input.email ?? existing.email,
        linkedin: input.linkedin ?? existing.linkedin,
        source: input.source ?? existing.source,
        score: input.score ?? existing.score,
        qualified,
        status,
        raw: mergedRaw,
      })
      .eq("id", existing.id);
    if (error) throw error;
    await archiveJson(input.workspaceId, input.projectId, existing.id, {
      ...existing,
      raw: mergedRaw,
    });
    return { id: existing.id, deduped: true, qualified };
  }

  const { data, error } = await db()
    .from("candidates")
    .insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      source: input.source ?? null,
      name: input.name ?? null,
      email: input.email ?? null,
      linkedin: input.linkedin ?? null,
      score: input.score ?? null,
      qualified,
      status,
      raw: fields,
      created_by: input.userId,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Could not save candidate");
  const row = data as Candidate;

  const storagePath = await archiveJson(
    input.workspaceId,
    input.projectId,
    row.id,
    row,
  );
  if (storagePath) {
    await db()
      .from("candidates")
      .update({ storage_path: storagePath })
      .eq("id", row.id);
  }

  return { id: row.id, deduped: false, qualified };
}
