"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getProject } from "../queries";
import type { CandidateFeedback } from "../types";

/** Save the project's Shortlist targets: goal (number of qualified candidates)
 *  and budget in USD. Either may be cleared (null). */
export async function setSourcingTargetsAction(
  projectId: string,
  goalQualified: number | null,
  budgetUsd: number | null,
): Promise<void> {
  const session = await requireSession();
  const project = await getProject(session.workspaceId, projectId);
  if (!project) throw new Error("Project not found");

  const goal =
    goalQualified != null && Number.isFinite(goalQualified) && goalQualified > 0
      ? Math.floor(goalQualified)
      : null;
  const budget =
    budgetUsd != null && Number.isFinite(budgetUsd) && budgetUsd > 0
      ? Math.round(budgetUsd * 100) / 100
      : null;

  const { error } = await db()
    .from("projects")
    .update({
      sourcing_goal_qualified: goal,
      sourcing_budget_usd: budget,
    })
    .eq("id", projectId);
  if (error) throw error;

  revalidatePath(
    `/clients/${project.client_id}/projects/${projectId}/shortlist`,
  );
}

/** Save the recruiter's fit verdict on a candidate (✓ accepted / ✗ rejected, or
 *  null to clear) plus an optional reason for rejections. Feeds future runs. */
export async function setCandidateFeedbackAction(
  candidateId: string,
  feedback: CandidateFeedback | null,
  reason: string | null,
): Promise<void> {
  const session = await requireSession();

  const { data: cand } = await db()
    .from("candidates")
    .select("id, project_id, workspace_id")
    .eq("id", candidateId)
    .maybeSingle();
  if (!cand || cand.workspace_id !== session.workspaceId) {
    throw new Error("Candidate not found");
  }
  // Confirms the project is in the caller's workspace and gives us the client id.
  const project = await getProject(session.workspaceId, cand.project_id as string);
  if (!project) throw new Error("Project not found");

  const cleanReason =
    feedback === "rejected" ? reason?.trim().slice(0, 500) || null : null;

  const { error } = await db()
    .from("candidates")
    .update({
      feedback,
      feedback_reason: cleanReason,
      feedback_at: feedback ? new Date().toISOString() : null,
      feedback_by: feedback ? session.userId : null,
    })
    .eq("id", candidateId);
  if (error) throw error;

  revalidatePath(
    `/clients/${project.client_id}/projects/${cand.project_id}/shortlist`,
  );
}
