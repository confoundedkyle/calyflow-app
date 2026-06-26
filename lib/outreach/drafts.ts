import "server-only";
import { db } from "../db";
import type { Candidate } from "../types";

export interface SaveOutreachDraftInput {
  workspaceId: string;
  projectId: string;
  userId: string;
  candidateId: string;
  subject: string;
  body: string;
}

export interface SaveOutreachDraftResult {
  id: string;
  to: string;
  replaced: boolean;
}

/**
 * Upsert an email draft for a candidate (one active draft per candidate). The
 * recipient is taken from the candidate's STORED email — never from the agent —
 * so a draft can't target an invented address. Throws if the candidate isn't in
 * the project or has no email.
 */
export async function saveOutreachDraft(
  input: SaveOutreachDraftInput,
): Promise<SaveOutreachDraftResult> {
  const { data: cand } = await db()
    .from("candidates")
    .select("id, project_id, name, email")
    .eq("id", input.candidateId)
    .maybeSingle();
  const candidate = cand as Pick<
    Candidate,
    "id" | "project_id" | "name" | "email"
  > | null;
  if (!candidate || candidate.project_id !== input.projectId) {
    throw new Error("Candidate not found in this project");
  }
  const email = candidate.email?.trim();
  if (!email) throw new Error("Candidate has no email — can't draft outreach");

  const { data: existing } = await db()
    .from("outreach_drafts")
    .select("id, status")
    .eq("project_id", input.projectId)
    .eq("candidate_id", input.candidateId)
    .maybeSingle();

  const row = {
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    candidate_id: input.candidateId,
    to_email: email,
    to_name: candidate.name,
    subject: input.subject,
    body: input.body,
    status: "draft" as const,
    edited: false,
    provider: null,
    sent_message_id: null,
    error: null,
    sent_at: null,
    created_by: input.userId,
  };

  if (existing) {
    // Re-drafting replaces the prior un-sent draft. Don't clobber a sent one.
    if ((existing as { status: string }).status === "sent") {
      return { id: existing.id as string, to: email, replaced: false };
    }
    const { error } = await db()
      .from("outreach_drafts")
      .update(row)
      .eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id as string, to: email, replaced: true };
  }

  const { data, error } = await db()
    .from("outreach_drafts")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Could not save draft");
  return { id: data.id as string, to: email, replaced: false };
}
