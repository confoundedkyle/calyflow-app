import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getActiveQualification,
  getActiveSourcingPlan,
  getActiveSourcingStrategyConversation,
  getProject,
  getSessionTargets,
  listConnections,
  listSourcingStrategySessions,
} from "@/lib/queries";
import { connectorSpendByProvider } from "@/lib/shortlist/spend";
import { getChannelSignals, sessionProgress } from "@/lib/sourcing/signals";
import { connectedProvidersFrom } from "@/lib/run-items";
import { connectorLabel, meteredConnectors } from "@/lib/connectors";
import { SourcingPanel } from "@/components/sourcing-panel";
import type { ShortlistRun } from "@/lib/types";

export default async function SourcingPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId, projectId } = await params;
  const { c: conversationParam } = await searchParams;
  const project = await getProject(session.workspaceId, projectId);
  if (!project || project.client.id !== clientId) notFound();

  const [
    plan,
    criteria,
    latestRunRes,
    connections,
    connectorSpend,
    signals,
    conversation,
    sessions,
  ] = await Promise.all([
    getActiveSourcingPlan(session.workspaceId, projectId),
    getActiveQualification(session.workspaceId, projectId),
    db()
      .from("shortlist_runs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    listConnections(session.workspaceId),
    connectorSpendByProvider(projectId),
    getChannelSignals(projectId),
    getActiveSourcingStrategyConversation(
      session.workspaceId,
      projectId,
      conversationParam,
    ),
    listSourcingStrategySessions(projectId),
  ]);

  // Goal, budget, qualified and spend are all SESSION-scoped now (the project
  // budget is the outer cap, managed in Settings).
  const activeConv = conversation?.conversationId ?? null;
  const sessionTargets = await getSessionTargets(projectId, activeConv);
  const { qualified, spent } = sessionProgress(signals, activeConv);

  const basePath = `/clients/${clientId}/projects/${projectId}`;
  const connectedProviders = connectedProvidersFrom(connections);

  const storedBudgets = project.sourcing_connector_budgets ?? {};
  const connectorBudgets = meteredConnectors(connectedProviders).map((c) => ({
    provider: c.provider as string,
    name: c.name,
    unit: c.unit ?? "credits",
    cap: storedBudgets[c.provider as string] ?? c.defaultBudget ?? null,
    spent: connectorSpend[c.provider as string] ?? 0,
  }));

  // A simple labelled list of connected sourcing/enrichment providers for the
  // "connectors at a glance" strip.
  const connectors = [...connectedProviders].map((p) => connectorLabel(p));

  return (
    <SourcingPanel
      key={conversation?.conversationId ?? "new"}
      projectId={project.id}
      archived={project.status !== "active"}
      goalQualified={sessionTargets.goalQualified}
      budgetUsd={sessionTargets.budgetUsd}
      spentUsd={spent}
      projectSpentUsd={signals.totals.costUsd}
      qualifiedCount={qualified}
      projectBudgetUsd={project.sourcing_budget_usd}
      connectorBudgets={connectorBudgets}
      connectors={connectors}
      signals={signals}
      hasPlan={!!plan}
      hasCriteria={!!criteria}
      shortlistHref={`${basePath}/shortlist`}
      documentsHref={`${basePath}/documents`}
      settingsHref={`${basePath}/settings`}
      connectorsHref="/settings/connectors"
      basePath={basePath}
      initialConversation={conversation}
      sessions={sessions}
      initialRun={(latestRunRes.data as ShortlistRun | null) ?? null}
    />
  );
}
