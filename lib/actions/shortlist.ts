"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getProject } from "../queries";

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
