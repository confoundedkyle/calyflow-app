import "server-only";
import { db } from "./db";

// Admin dashboard data — deliberately NOT workspace-scoped (the service-role
// `db()` client bypasses RLS), so a platform admin sees activity across every
// workspace. Gate all callers with isPlatformAdmin().

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  spentUsd: number;
  runCount: number;
}

export interface AdminRunRow {
  id: string;
  kind: string; // agent | workflow | sourcing | sourcing-plan | qualification | shortlist | outreach | onboarding
  name: string;
  provider: string | null;
  model: string | null;
  tokens: number;
  costUsd: number | null;
  createdAt: string;
  runnerId: string | null;
  runnerName: string | null;
}

// Every table that records an AI run + its cost. Besides the classic agent /
// workflow runs, each sourcing-pipeline step (and KB onboarding) records its own
// runs in a dedicated table — users who only use the new flow would otherwise
// show 0 runs / $0 spent here.
const RUN_TABLES = [
  "agent_runs",
  "workflow_runs",
  "sourcing_plan_runs",
  "qualification_runs",
  "shortlist_runs",
  "outreach_runs",
  "sourcing_strategy_runs",
  "kb_onboarding_runs",
] as const;

/** Per-user spend (USD) and run count, summed across every run table. */
async function usageByUser(): Promise<Map<string, { spent: number; runs: number }>> {
  const map = new Map<string, { spent: number; runs: number }>();
  for (const table of RUN_TABLES) {
    const { data } = await db().from(table).select("created_by, cost_usd");
    for (const row of (data ?? []) as {
      created_by: string | null;
      cost_usd: number | null;
    }[]) {
      const id = row.created_by;
      if (!id) continue;
      const cur = map.get(id) ?? { spent: 0, runs: 0 };
      cur.spent += Number(row.cost_usd ?? 0);
      cur.runs += 1;
      map.set(id, cur);
    }
  }
  return map;
}

/** All registered users (from Clerk) enriched with their spend and run count. */
export async function adminListUsers(): Promise<AdminUser[]> {
  const usage = await usageByUser();
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ limit: 200 });
  return users
    .map((u) => {
      const stats = usage.get(u.id) ?? { spent: 0, runs: 0 };
      return {
        id: u.id,
        email: u.emailAddresses[0]?.emailAddress ?? "—",
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
        createdAt: u.createdAt,
        lastSignInAt: u.lastSignInAt,
        spentUsd: stats.spent,
        runCount: stats.runs,
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** All runs (agent + workflow) excluding the admin's own, newest first. */
export async function adminListRuns(
  excludeUserId: string,
  limit = 100,
): Promise<AdminRunRow[]> {
  const select =
    "id, created_by, provider, model, input_tokens, output_tokens, cost_usd, created_at";
  // Sourcing-pipeline steps (+ KB onboarding) have no agent/workflow name, so
  // give each a fixed label. Keeps the feed complete alongside classic runs.
  const pipelineFeed = [
    { table: "sourcing_strategy_runs", kind: "sourcing", name: "Sourcing" },
    { table: "sourcing_plan_runs", kind: "sourcing-plan", name: "Sourcing Plan" },
    { table: "qualification_runs", kind: "qualification", name: "Qualification" },
    { table: "shortlist_runs", kind: "shortlist", name: "Shortlist" },
    { table: "outreach_runs", kind: "outreach", name: "Outreach" },
    { table: "kb_onboarding_runs", kind: "onboarding", name: "KB onboarding" },
  ] as const;
  const [{ data: agentRuns }, { data: workflowRuns }, ...pipelineResults] =
    await Promise.all([
      db()
        .from("agent_runs")
        .select(`${select}, agent:workspace_agents(name)`)
        .neq("created_by", excludeUserId)
        .order("created_at", { ascending: false })
        .limit(limit),
      db()
        .from("workflow_runs")
        .select(`${select}, workflow:workspace_workflows(name)`)
        .neq("created_by", excludeUserId)
        .order("created_at", { ascending: false })
        .limit(limit),
      ...pipelineFeed.map((p) =>
        db()
          .from(p.table)
          .select(select)
          .neq("created_by", excludeUserId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ),
    ]);

  // Resolve runner names from Clerk in one pass.
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ limit: 200 });
  const nameById = new Map(
    users.map((u) => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(" ") ||
        u.emailAddresses[0]?.emailAddress ||
        null,
    ]),
  );

  type Raw = {
    id: string;
    created_by: string | null;
    provider: string | null;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    created_at: string;
    agent?: { name: string } | null;
    workflow?: { name: string } | null;
  };

  const rows: AdminRunRow[] = [
    ...((agentRuns ?? []) as unknown as Raw[]).map((r) => ({
      id: r.id,
      kind: "agent" as const,
      name: r.agent?.name ?? "Agent",
      provider: r.provider,
      model: r.model,
      tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
      costUsd: r.cost_usd,
      createdAt: r.created_at,
      runnerId: r.created_by,
      runnerName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
    })),
    ...((workflowRuns ?? []) as unknown as Raw[]).map((r) => ({
      id: r.id,
      kind: "workflow" as const,
      name: r.workflow?.name ?? "Workflow",
      provider: r.provider,
      model: r.model,
      tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
      costUsd: r.cost_usd,
      createdAt: r.created_at,
      runnerId: r.created_by,
      runnerName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
    })),
    ...pipelineFeed.flatMap((p, i) =>
      ((pipelineResults[i]?.data ?? []) as unknown as Raw[]).map((r) => ({
        id: r.id,
        kind: p.kind,
        name: p.name,
        provider: r.provider,
        model: r.model,
        tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
        costUsd: r.cost_usd,
        createdAt: r.created_at,
        runnerId: r.created_by,
        runnerName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
      })),
    ),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return rows;
}
