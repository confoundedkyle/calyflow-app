import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProject } from "@/lib/queries";
import { listCandidates } from "@/lib/candidates/queries";
import { selectOutreachCandidates } from "@/lib/outreach/select";
import { listOutreachDrafts } from "@/lib/outreach/queries";
import { listConnectedEmailProviders } from "@/lib/outreach/send";
import { OutreachPanel } from "@/components/outreach-panel";
import type { OutreachRun } from "@/lib/types";

export default async function OutreachPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId, projectId } = await params;
  const project = await getProject(session.workspaceId, projectId);
  if (!project || project.client.id !== clientId) notFound();

  const [candidates, drafts, mailboxes, latestRunRes] = await Promise.all([
    listCandidates(projectId),
    listOutreachDrafts(projectId),
    listConnectedEmailProviders(session.workspaceId),
    db()
      .from("outreach_runs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const eligibleCount = selectOutreachCandidates(candidates).length;
  const basePath = `/clients/${clientId}/projects/${projectId}`;

  return (
    <OutreachPanel
      projectId={project.id}
      archived={project.status !== "active"}
      drafts={drafts}
      eligibleCount={eligibleCount}
      mailboxes={mailboxes}
      connectorsHref="/settings/connectors"
      shortlistHref={`${basePath}/shortlist`}
      initialRun={(latestRunRes.data as OutreachRun | null) ?? null}
    />
  );
}
