import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProject, getUserPreferences } from "@/lib/queries";
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

  const [candidates, drafts, mailboxes, prefs, latestRunRes] =
    await Promise.all([
      listCandidates(projectId),
      listOutreachDrafts(projectId),
      listConnectedEmailProviders(session.workspaceId),
      getUserPreferences(session.workspaceId, session.userId),
      db()
        .from("outreach_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const eligibleCount = selectOutreachCandidates(candidates).length;
  // Drafts can only be signed correctly when the recruiter has set up their
  // name / signature (Settings → Personal). Without it the agent has nothing to
  // sign off with, so prompt the recruiter to set it up.
  const senderConfigured = !!(
    prefs?.email_signature?.trim() ||
    prefs?.first_name?.trim() ||
    prefs?.last_name?.trim()
  );
  const basePath = `/clients/${clientId}/projects/${projectId}`;

  return (
    <OutreachPanel
      projectId={project.id}
      archived={project.status !== "active"}
      drafts={drafts}
      eligibleCount={eligibleCount}
      mailboxes={mailboxes}
      senderConfigured={senderConfigured}
      connectorsHref="/settings/connectors"
      personalHref="/settings/personal"
      shortlistHref={`${basePath}/shortlist`}
      initialRun={(latestRunRes.data as OutreachRun | null) ?? null}
    />
  );
}
