import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getActiveQualification,
  getActiveSourcingPlan,
  getProject,
} from "@/lib/queries";
import { listCandidates, countQualified } from "@/lib/candidates/queries";
import { shortlistSpentUsd } from "@/lib/shortlist/spend";
import { ShortlistPanel } from "@/components/shortlist-panel";
import type { ShortlistRun } from "@/lib/types";

export default async function ShortlistPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId, projectId } = await params;
  const project = await getProject(session.workspaceId, projectId);
  if (!project || project.client.id !== clientId) notFound();

  const [candidates, qualified, spentUsd, plan, criteria, latestRunRes] =
    await Promise.all([
      listCandidates(projectId),
      countQualified(projectId),
      shortlistSpentUsd(projectId),
      getActiveSourcingPlan(session.workspaceId, projectId),
      getActiveQualification(session.workspaceId, projectId),
      db()
        .from("shortlist_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const basePath = `/clients/${clientId}/projects/${projectId}`;

  return (
    <ShortlistPanel
      projectId={project.id}
      archived={project.status !== "active"}
      candidates={candidates}
      qualifiedCount={qualified}
      goalQualified={project.sourcing_goal_qualified}
      budgetUsd={project.sourcing_budget_usd}
      spentUsd={spentUsd}
      hasPlan={!!plan}
      hasCriteria={!!criteria}
      sourcingPlanHref={`${basePath}/sourcing-plan`}
      qualificationHref={`${basePath}/qualification`}
      initialRun={(latestRunRes.data as ShortlistRun | null) ?? null}
    />
  );
}
