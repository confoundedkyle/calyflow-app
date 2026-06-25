import "server-only";
import { cache } from "react";
import { isAgenticModel, providerLabel } from "./ai-catalog";
import { db } from "./db";
import { env } from "./env";
import { requiredConnectorCategories } from "./connectors";
import type {
  AgentChatTurn,
  AgentRun,
  AiProvider,
  AtsCandidate,
  AutomationStats,
  AutomationWithRuns,
  CatalogModel,
  Client,
  Connection,
  CrmAccount,
  CrmLead,
  Doc,
  DocKind,
  DocScope,
  LibraryAgent,
  LibraryAutomation,
  LibraryWorkflow,
  ModuleKey,
  Project,
  TalentProspect,
  UserPreferences,
  WorkflowRun,
  WorkspaceAgent,
  WorkspaceAutomation,
  WorkspaceModule,
  WorkspaceWorkflow,
} from "./types";

export type CrmLeadWithAccount = CrmLead & {
  account: { id: string; name: string } | null;
};

export type AtsCandidateWithProject = AtsCandidate & {
  project:
    | { id: string; name: string; client: { id: string; name: string } | null }
    | null;
};

// All reads are scoped by workspace_id resolved from the session — never from
// the client (SPEC §9 tenant isolation rule).

export async function listClientsWithProjects(
  workspaceId: string,
): Promise<(Client & { projects: Project[] })[]> {
  const { data, error } = await db()
    .from("clients")
    .select("*, projects(*)")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("is_demo", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    ...c,
    projects: ((c.projects ?? []) as Project[])
      // The demo project is hidden even if it ever lands under a real client.
      .filter((p) => p.status === "active" && !p.is_demo)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
  }));
}

/** The workspace's Demo client + its demo project, for the sidebar's DEMO
 *  section. Null until `ensureDemoProject` has provisioned it. Mirrors
 *  `listClientsWithProjects` but for the `is_demo` rows it deliberately hides. */
export async function getDemoClientWithProject(
  workspaceId: string,
): Promise<(Client & { projects: Project[] }) | null> {
  const { data, error } = await db()
    .from("clients")
    .select("*, projects(*)")
    .eq("workspace_id", workspaceId)
    .eq("is_demo", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...(data as Client & { projects: Project[] }),
    projects: ((data.projects ?? []) as Project[]).filter((p) => p.is_demo),
  };
}

/** A user's personal preferences (Settings > Personal) for this workspace, or
 *  null if they haven't saved any yet. */
export async function getUserPreferences(
  workspaceId: string,
  userId: string,
): Promise<UserPreferences | null> {
  const { data } = await db()
    .from("user_preferences")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as UserPreferences | null;
}

/** Map of workspace member user_id → display name, from user_preferences (which
 *  mirrors Clerk). Lets run history show who ran each agent without a Clerk
 *  round-trip. Members with no name set are omitted. */
export async function listWorkspaceMemberNames(
  workspaceId: string,
): Promise<Record<string, string>> {
  const { data } = await db()
    .from("user_preferences")
    .select("user_id, first_name, last_name")
    .eq("workspace_id", workspaceId);
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
  }[]) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    if (name) map[r.user_id] = name;
  }
  return map;
}

export async function listClients(workspaceId: string): Promise<Client[]> {
  const { data, error } = await db()
    .from("clients")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_demo", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Client[];
}

export async function getClient(
  workspaceId: string,
  clientId: string,
): Promise<Client | null> {
  const { data } = await db()
    .from("clients")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", clientId)
    .maybeSingle();
  return data as Client | null;
}

export async function listProjects(
  workspaceId: string,
  clientId: string,
): Promise<Project[]> {
  const client = await getClient(workspaceId, clientId);
  if (!client) return [];
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export async function getProject(
  workspaceId: string,
  projectId: string,
): Promise<(Project & { client: Client }) | null> {
  const { data } = await db()
    .from("projects")
    .select("*, client:clients!inner(*)")
    .eq("id", projectId)
    .eq("client.workspace_id", workspaceId)
    .maybeSingle();
  return data as (Project & { client: Client }) | null;
}

export async function listDocuments(
  workspaceId: string,
  scopeType: DocScope,
  scopeId: string,
  kind?: DocKind,
): Promise<Doc[]> {
  let query = db()
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .order("created_at", { ascending: true });
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (error) throw error;
  return data as Doc[];
}

export async function getDocument(
  workspaceId: string,
  docId: string,
): Promise<Doc | null> {
  const { data } = await db()
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", docId)
    .maybeSingle();
  return data as Doc | null;
}

export async function listLibraryWorkflows(): Promise<LibraryWorkflow[]> {
  const { data, error } = await db()
    .from("library_workflows")
    .select("*")
    .order("name");
  if (error) throw error;
  return data as LibraryWorkflow[];
}

export async function getLibraryWorkflowBySlug(
  slug: string,
): Promise<LibraryWorkflow | null> {
  const { data } = await db()
    .from("library_workflows")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as LibraryWorkflow) ?? null;
}

export async function listWorkspaceWorkflows(
  workspaceId: string,
): Promise<(WorkspaceWorkflow & { library: LibraryWorkflow | null })[]> {
  const { data, error } = await db()
    .from("workspace_workflows")
    .select("*, library:library_workflows(*)")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) throw error;
  return data as (WorkspaceWorkflow & { library: LibraryWorkflow | null })[];
}

export async function getWorkspaceWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<(WorkspaceWorkflow & { library: LibraryWorkflow | null }) | null> {
  const { data } = await db()
    .from("workspace_workflows")
    .select("*, library:library_workflows(*)")
    .eq("workspace_id", workspaceId)
    .eq("id", workflowId)
    .maybeSingle();
  return data as
    | (WorkspaceWorkflow & { library: LibraryWorkflow | null })
    | null;
}

export async function listProviders(
  workspaceId: string,
): Promise<AiProvider[]> {
  const { data, error } = await db()
    .from("workspace_ai_providers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("priority");
  if (error) throw error;
  return data as AiProvider[];
}

/** Provider + model a run would use right now (first usable row by priority).
 *  Display-only — unlike resolveRunProviders it never decrypts API keys. */
export async function getPrimaryRunModel(
  workspaceId: string,
): Promise<{ provider: string; providerLabel: string; modelId: string } | null> {
  const providers = await listProviders(workspaceId);
  for (const row of providers) {
    if (row.provider === "calyflow") {
      if (!env.platformProviderEnabled) continue;
      return {
        provider: env.platformProvider,
        providerLabel: providerLabel(env.platformProvider),
        modelId: env.platformModel,
      };
    }
    if (!row.api_key_cipher || !row.default_model) continue;
    return {
      provider: row.provider,
      providerLabel: providerLabel(row.provider),
      modelId: row.default_model,
    };
  }
  return null;
}

export async function listCatalogModels(
  provider?: string,
): Promise<CatalogModel[]> {
  let query = db().from("model_catalog").select("*").order("model_id");
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  if (error) throw error;
  // Hide lightweight mini/nano tiers from selection even if older rows linger
  // in the table — they don't reliably run multi-step agents.
  return (data as CatalogModel[]).filter((m) => isAgenticModel(m.model_id));
}

export async function listRuns(
  workspaceId: string,
  projectId: string,
): Promise<(WorkflowRun & { workflow: { name: string } | null })[]> {
  const project = await getProject(workspaceId, projectId);
  if (!project) return [];
  const { data, error } = await db()
    .from("workflow_runs")
    .select("*, workflow:workspace_workflows(name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as (WorkflowRun & { workflow: { name: string } | null })[];
}

export async function getRun(
  workspaceId: string,
  runId: string,
): Promise<
  | (WorkflowRun & {
      workflow: { name: string } | null;
      project: Project & { client: Client };
    })
  | null
> {
  const { data } = await db()
    .from("workflow_runs")
    .select(
      "*, workflow:workspace_workflows(name), project:projects!inner(*, client:clients!inner(*))",
    )
    .eq("id", runId)
    .eq("project.client.workspace_id", workspaceId)
    .maybeSingle();
  return data as
    | (WorkflowRun & {
        workflow: { name: string } | null;
        project: Project & { client: Client };
      })
    | null;
}

export async function getAgentRun(
  workspaceId: string,
  runId: string,
): Promise<
  | (AgentRun & {
      agent: { name: string } | null;
      project: Project & { client: Client };
    })
  | null
> {
  const { data } = await db()
    .from("agent_runs")
    .select(
      "*, agent:workspace_agents(name), project:projects!inner(*, client:clients!inner(*))",
    )
    .eq("id", runId)
    .eq("project.client.workspace_id", workspaceId)
    .maybeSingle();
  return data as
    | (AgentRun & {
        agent: { name: string } | null;
        project: Project & { client: Client };
      })
    | null;
}

export async function listRecentRuns(
  workspaceId: string,
  limit = 8,
): Promise<
  (WorkflowRun & {
    workflow: { name: string } | null;
    project: { id: string; name: string } | null;
  })[]
> {
  const { data, error } = await db()
    .from("workflow_runs")
    .select(
      "*, workflow:workspace_workflows!inner(name, workspace_id), project:projects(id, name)",
    )
    .eq("workspace_workflows.workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as (WorkflowRun & {
    workflow: { name: string } | null;
    project: { id: string; name: string } | null;
  })[];
}

// --- Data-source connectors ---

export async function listConnections(
  workspaceId: string,
): Promise<Connection[]> {
  const { data, error } = await db()
    .from("workspace_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) throw error;
  return data as Connection[];
}

export async function getConnection(
  workspaceId: string,
  provider: string,
): Promise<Connection | null> {
  const { data } = await db()
    .from("workspace_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  return data as Connection | null;
}

// --- Dynamic data agents ---

export async function listLibraryAgents(): Promise<LibraryAgent[]> {
  const { data, error } = await db()
    .from("library_agents")
    .select("*")
    .order("name");
  if (error) throw error;
  return data as LibraryAgent[];
}

export async function getLibraryAgentBySlug(
  slug: string,
): Promise<LibraryAgent | null> {
  const { data } = await db()
    .from("library_agents")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as LibraryAgent) ?? null;
}

export async function listWorkspaceAgents(
  workspaceId: string,
): Promise<(WorkspaceAgent & { library: LibraryAgent | null })[]> {
  const { data, error } = await db()
    .from("workspace_agents")
    .select("*, library:library_agents(*)")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) throw error;
  return data as (WorkspaceAgent & { library: LibraryAgent | null })[];
}

export async function getWorkspaceAgent(
  workspaceId: string,
  agentId: string,
): Promise<WorkspaceAgent | null> {
  const { data } = await db()
    .from("workspace_agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", agentId)
    .maybeSingle();
  return data as WorkspaceAgent | null;
}

/** A workspace's imported copy of a library agent, found via the library slug —
 *  lets automated triggers (the report cron) locate the right workspace agent
 *  without knowing its id. Returns the newest non-archived copy. */
export async function getWorkspaceAgentByLibrarySlug(
  workspaceId: string,
  slug: string,
): Promise<WorkspaceAgent | null> {
  const { data } = await db()
    .from("workspace_agents")
    .select("*, library:library_agents!inner(slug)")
    .eq("workspace_id", workspaceId)
    .eq("library_agents.slug", slug)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as WorkspaceAgent) ?? null;
}

// --- Automation Hub ---

export async function listLibraryAutomations(): Promise<LibraryAutomation[]> {
  const { data, error } = await db()
    .from("library_automations")
    .select("*")
    .order("name");
  if (error) throw error;
  return (data ?? []) as LibraryAutomation[];
}

export async function getLibraryAutomation(
  id: string,
): Promise<LibraryAutomation | null> {
  const { data } = await db()
    .from("library_automations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as LibraryAutomation) ?? null;
}

export async function getWorkspaceAutomation(
  workspaceId: string,
  id: string,
): Promise<(WorkspaceAutomation & { library: LibraryAutomation | null }) | null> {
  const { data } = await db()
    .from("workspace_automations")
    .select("*, library:library_automations(*)")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return (data as WorkspaceAutomation & { library: LibraryAutomation | null }) ?? null;
}

/** The workspace's configured automations for the Hub table — each with its
 *  library row, latest run, and the statuses of its last 5 runs (the RECENT
 *  squares, ordered oldest → newest). */
export async function listWorkspaceAutomations(
  workspaceId: string,
): Promise<AutomationWithRuns[]> {
  const { data, error } = await db()
    .from("workspace_automations")
    .select("*, library:library_automations(*)")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("created_at");
  if (error) throw error;
  const automations = (data ?? []) as (WorkspaceAutomation & {
    library: LibraryAutomation | null;
  })[];
  if (automations.length === 0) return [];

  const { data: runData } = await db()
    .from("agent_runs")
    .select("workspace_automation_id, status, created_at, output_text, error_message")
    .in("workspace_automation_id", automations.map((a) => a.id))
    .order("created_at", { ascending: false });
  const runs = (runData ?? []) as (Pick<
    AgentRun,
    "status" | "created_at" | "output_text" | "error_message"
  > & { workspace_automation_id: string })[];

  const byAutomation = new Map<string, typeof runs>();
  for (const r of runs) {
    const list = byAutomation.get(r.workspace_automation_id) ?? [];
    list.push(r);
    byAutomation.set(r.workspace_automation_id, list);
  }

  return automations.map((a) => {
    const its = byAutomation.get(a.id) ?? []; // newest → oldest
    return {
      ...a,
      lastRun: its[0]
        ? {
            status: its[0].status,
            created_at: its[0].created_at,
            output_text: its[0].output_text,
            error_message: its[0].error_message,
          }
        : null,
      recentStatuses: its
        .slice(0, 5)
        .map((r) => r.status)
        .reverse(), // oldest → newest for left-to-right squares
    };
  });
}

/** The three Hub stat tiles. Needs-attention = enabled automations that failed
 *  OR whose bound connector exists but is errored/revoked. */
export async function getAutomationStats(
  workspaceId: string,
): Promise<AutomationStats> {
  const [{ data: autoData }, connections] = await Promise.all([
    db()
      .from("workspace_automations")
      .select("id, name, enabled, status, connector_bindings, allowed_tools")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null),
    listConnections(workspaceId),
  ]);
  const automations = (autoData ?? []) as Pick<
    WorkspaceAutomation,
    "id" | "name" | "enabled" | "status" | "connector_bindings" | "allowed_tools"
  >[];
  const statusByProvider = new Map(
    connections.map((c) => [c.provider, c.status]),
  );
  const connected = (a: (typeof automations)[number]) =>
    requiredConnectorCategories(a.allowed_tools ?? []).every((cat) => {
      const provider = a.connector_bindings?.[cat];
      return provider != null && statusByProvider.get(provider) === "active";
    });

  // Active = enabled AND fully connected (it can actually run). Anything enabled
  // but not connected, or in a failed state, needs attention.
  const enabled = automations.filter((a) => a.enabled);
  const active = enabled.filter((a) => connected(a));
  const needing = enabled.filter((a) => !connected(a) || a.status === "failed");

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data: todayRuns } = await db()
    .from("agent_runs")
    .select("status, automation:workspace_automations!inner(workspace_id)")
    .eq("workspace_automations.workspace_id", workspaceId)
    .gte("created_at", startOfDay.toISOString());
  const runs = (todayRuns ?? []) as { status: AgentRun["status"] }[];
  const succeeded = runs.filter((r) => r.status === "succeeded").length;

  return {
    activeCount: active.length,
    runsToday: runs.length,
    successPct: runs.length ? Math.round((succeeded / runs.length) * 100) : null,
    needsAttention: {
      count: needing.length,
      firstName: needing[0]?.name ?? null,
    },
  };
}

/** Enabled automations that are due to run, across ALL workspaces — the
 *  automation cron is unauthenticated (service-role) and fans out over every
 *  workspace, so this read is intentionally NOT workspace-scoped. Due = no
 *  next_run_at yet, or next_run_at in the past. */
export async function listAutomationsDue(
  now: Date,
): Promise<(WorkspaceAutomation & { library: { task: string | null } | null })[]> {
  const { data, error } = await db()
    .from("workspace_automations")
    .select("*, library:library_automations(task)")
    .eq("enabled", true)
    .is("archived_at", null)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`);
  if (error) throw error;
  return (data ?? []) as (WorkspaceAutomation & {
    library: { task: string | null } | null;
  })[];
}

/** Active projects that want an automated Slack report, across ALL workspaces —
 *  the report cron is unauthenticated (service-role) and fans out over every
 *  workspace, so this read is intentionally NOT workspace-scoped. */
export async function listProjectsDueForReport(): Promise<
  (Project & { client: Pick<Client, "id" | "name" | "workspace_id"> })[]
> {
  const { data, error } = await db()
    .from("projects")
    .select("*, client:clients!inner(id, name, workspace_id)")
    .eq("status", "active")
    .neq("report_frequency", "off")
    .not("slack_channel_id", "is", null);
  if (error) throw error;
  return (data ?? []) as (Project & {
    client: Pick<Client, "id" | "name" | "workspace_id">;
  })[];
}

/** The active project mapped to a Slack channel, across ALL workspaces — the
 *  inbound Slack bot is authenticated by Slack's signature, not a session, so it
 *  resolves the workspace from the channel. Returns null when no project maps it. */
export async function getProjectBySlackChannel(
  channelId: string,
): Promise<
  (Project & { client: Pick<Client, "id" | "name" | "workspace_id"> }) | null
> {
  const { data } = await db()
    .from("projects")
    .select("*, client:clients!inner(id, name, workspace_id)")
    .eq("slack_channel_id", channelId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return (data as
    | (Project & { client: Pick<Client, "id" | "name" | "workspace_id"> })
    | null) ?? null;
}

/** A real user id to attribute automated runs to (the report cron has no
 *  session). Prefers a recently-active member, then any member with saved prefs,
 *  else a synthetic id so the run still records. */
export async function getWorkspaceServiceUserId(
  workspaceId: string,
): Promise<string> {
  const { data: recent } = await db()
    .from("agent_runs")
    .select("created_by, workspace_agents!inner(workspace_id)")
    .eq("workspace_agents.workspace_id", workspaceId)
    .not("created_by", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const recentUser = (recent as { created_by?: string } | null)?.created_by;
  if (recentUser) return recentUser;

  const { data: member } = await db()
    .from("user_preferences")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();
  return (member?.user_id as string | undefined) ?? "slack-reporter";
}

export async function listAgentRuns(
  workspaceId: string,
  projectId: string,
): Promise<(AgentRun & { agent: { name: string } | null })[]> {
  const project = await getProject(workspaceId, projectId);
  if (!project) return [];
  const { data, error } = await db()
    .from("agent_runs")
    .select("*, agent:workspace_agents(name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as (AgentRun & { agent: { name: string } | null })[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A chat conversation for an agent in a project, with its turns oldest-first —
 *  drives the run panel's resumable chat. Pass `conversationId` (from the URL)
 *  to load that specific chat; omit it to load the most recent one. Returns null
 *  when the agent has no matching runs. */
export async function getActiveAgentConversation(
  workspaceId: string,
  projectId: string,
  workspaceAgentId: string,
  conversationId?: string | null,
): Promise<{ conversationId: string; turns: AgentChatTurn[] } | null> {
  const project = await getProject(workspaceId, projectId);
  if (!project) return null;

  let convId =
    conversationId && UUID_RE.test(conversationId) ? conversationId : null;
  if (!convId) {
    const { data: latest } = await db()
      .from("agent_runs")
      .select("conversation_id")
      .eq("project_id", projectId)
      .eq("workspace_agent_id", workspaceAgentId)
      .not("conversation_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    convId = (latest?.conversation_id as string | null) ?? null;
  }
  if (!convId) return null;

  const { data, error } = await db()
    .from("agent_runs")
    .select(
      "id, task, output_text, steps, output_doc_id, status, error_message, created_at",
    )
    .eq("project_id", projectId)
    .eq("workspace_agent_id", workspaceAgentId)
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const turns = (data ?? []) as AgentChatTurn[];
  // An explicit (URL) id with no rows yet is still a valid, empty chat — keep
  // the id so the URL stays stable. A "latest" lookup with no rows is null.
  if (turns.length === 0 && !conversationId) return null;
  return { conversationId: convId, turns };
}

/** The project's single active sourcing-plan document (markdown), or null. One
 *  active plan per project; regenerating archives the previous one. */
export async function getActiveSourcingPlan(
  workspaceId: string,
  projectId: string,
): Promise<Doc | null> {
  const { data } = await db()
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scope_type", "project")
    .eq("scope_id", projectId)
    .eq("doc_type", "sourcing_plan")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Doc | null) ?? null;
}

/** The sourcing-plan generate/revise chat for a project, turns oldest-first.
 *  Mirrors getActiveAgentConversation but reads sourcing_plan_runs (which carry
 *  no workspace_agent_id). Pass conversationId to load that chat; omit for the
 *  most recent. */
export async function getActiveSourcingPlanConversation(
  workspaceId: string,
  projectId: string,
  conversationId?: string | null,
): Promise<{ conversationId: string; turns: AgentChatTurn[] } | null> {
  const project = await getProject(workspaceId, projectId);
  if (!project) return null;

  let convId =
    conversationId && UUID_RE.test(conversationId) ? conversationId : null;
  if (!convId) {
    const { data: latest } = await db()
      .from("sourcing_plan_runs")
      .select("conversation_id")
      .eq("project_id", projectId)
      .not("conversation_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    convId = (latest?.conversation_id as string | null) ?? null;
  }
  if (!convId) return null;

  const { data, error } = await db()
    .from("sourcing_plan_runs")
    .select(
      "id, task, output_text, steps, output_doc_id, status, error_message, created_at",
    )
    .eq("project_id", projectId)
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const turns = (data ?? []) as AgentChatTurn[];
  if (turns.length === 0 && !conversationId) return null;
  return { conversationId: convId, turns };
}

/** The project's single active qualification-criteria document, or null. One
 *  active per project; regenerating archives the previous one. */
export async function getActiveQualification(
  workspaceId: string,
  projectId: string,
): Promise<Doc | null> {
  const { data } = await db()
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scope_type", "project")
    .eq("scope_id", projectId)
    .eq("doc_type", "qualification")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Doc | null) ?? null;
}

/** The qualification generate/revise chat for a project, turns oldest-first.
 *  Mirrors getActiveSourcingPlanConversation but reads qualification_runs. */
export async function getActiveQualificationConversation(
  workspaceId: string,
  projectId: string,
  conversationId?: string | null,
): Promise<{ conversationId: string; turns: AgentChatTurn[] } | null> {
  const project = await getProject(workspaceId, projectId);
  if (!project) return null;

  let convId =
    conversationId && UUID_RE.test(conversationId) ? conversationId : null;
  if (!convId) {
    const { data: latest } = await db()
      .from("qualification_runs")
      .select("conversation_id")
      .eq("project_id", projectId)
      .not("conversation_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    convId = (latest?.conversation_id as string | null) ?? null;
  }
  if (!convId) return null;

  const { data, error } = await db()
    .from("qualification_runs")
    .select(
      "id, task, output_text, steps, output_doc_id, status, error_message, created_at",
    )
    .eq("project_id", projectId)
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const turns = (data ?? []) as AgentChatTurn[];
  if (turns.length === 0 && !conversationId) return null;
  return { conversationId: convId, turns };
}

export async function listRecentAgentRuns(
  workspaceId: string,
  limit = 8,
): Promise<
  (AgentRun & {
    agent: { name: string } | null;
    project: { id: string; name: string } | null;
  })[]
> {
  const { data, error } = await db()
    .from("agent_runs")
    .select(
      "*, agent:workspace_agents!inner(name, workspace_id), project:projects(id, name)",
    )
    .eq("workspace_agents.workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as (AgentRun & {
    agent: { name: string } | null;
    project: { id: string; name: string } | null;
  })[];
}

// --- Activatable workspace modules ---

export async function listModules(
  workspaceId: string,
): Promise<WorkspaceModule[]> {
  const { data, error } = await db()
    .from("workspace_modules")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return data as WorkspaceModule[];
}

/**
 * Module keys the workspace has switched on — drives the sidebar nav.
 * cache()-wrapped: the layout and module page guards both call this within
 * one request, so the result is shared instead of hitting the DB twice.
 */
export const listActiveModuleKeys = cache(
  async (workspaceId: string): Promise<ModuleKey[]> => {
    const { data, error } = await db()
      .from("workspace_modules")
      .select("module_key")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);
    // Tolerate the table not existing yet (migration 0007 not applied) so the
    // rest of the app keeps working — treat as no active modules.
    if (error) {
      if (error.code === "PGRST205") return [];
      throw error;
    }
    return (data ?? []).map((r) => r.module_key as ModuleKey);
  },
);

// --- CRM ---

export async function listAccounts(
  workspaceId: string,
): Promise<CrmAccount[]> {
  const { data, error } = await db()
    .from("crm_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as CrmAccount[];
}

export async function getAccount(
  workspaceId: string,
  accountId: string,
): Promise<CrmAccount | null> {
  const { data } = await db()
    .from("crm_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", accountId)
    .maybeSingle();
  return data as CrmAccount | null;
}

export async function listLeads(
  workspaceId: string,
): Promise<CrmLeadWithAccount[]> {
  const { data, error } = await db()
    .from("crm_leads")
    .select("*, account:crm_accounts(id, name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as CrmLeadWithAccount[];
}

export async function getLead(
  workspaceId: string,
  leadId: string,
): Promise<CrmLead | null> {
  const { data } = await db()
    .from("crm_leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", leadId)
    .maybeSingle();
  return data as CrmLead | null;
}

// --- ATS ---

export async function listCandidates(
  workspaceId: string,
): Promise<AtsCandidateWithProject[]> {
  const { data, error } = await db()
    .from("ats_candidates")
    .select("*, project:projects(id, name, client:clients(id, name))")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as AtsCandidateWithProject[];
}

export async function getCandidate(
  workspaceId: string,
  candidateId: string,
): Promise<AtsCandidate | null> {
  const { data } = await db()
    .from("ats_candidates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", candidateId)
    .maybeSingle();
  return data as AtsCandidate | null;
}

// --- Target Talent Pool ---

export async function listProspects(
  workspaceId: string,
): Promise<TalentProspect[]> {
  const { data, error } = await db()
    .from("talent_prospects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as TalentProspect[];
}

export async function getProspect(
  workspaceId: string,
  prospectId: string,
): Promise<TalentProspect | null> {
  const { data } = await db()
    .from("talent_prospects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", prospectId)
    .maybeSingle();
  return data as TalentProspect | null;
}

/** All-provider spend for the current calendar month (UTC), in USD —
 *  workflow runs and agent runs combined. */
export async function monthSpendUsd(workspaceId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const since = monthStart.toISOString();
  const [workflowSpend, agentSpend] = await Promise.all([
    db()
      .from("workflow_runs")
      .select("cost_usd, workspace_workflows!inner(workspace_id)")
      .eq("workspace_workflows.workspace_id", workspaceId)
      .gte("created_at", since),
    db()
      .from("agent_runs")
      .select("cost_usd, workspace_agents!inner(workspace_id)")
      .eq("workspace_agents.workspace_id", workspaceId)
      .gte("created_at", since),
  ]);
  if (workflowSpend.error) throw workflowSpend.error;
  // Tolerate agent_runs not existing yet (migration 0006 not applied) so the
  // rest of the app keeps working — count agent spend as 0 until it's there.
  if (agentSpend.error && agentSpend.error.code !== "PGRST205") {
    throw agentSpend.error;
  }
  const sum = (rows: { cost_usd: number | null }[] | null) =>
    (rows ?? []).reduce((acc, row) => acc + Number(row.cost_usd ?? 0), 0);
  return sum(workflowSpend.data) + sum(agentSpend.data);
}
