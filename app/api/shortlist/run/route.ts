import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkBudgets } from "@/lib/budgets";
import { resolveRunProviders } from "@/lib/providers";
import { getProject } from "@/lib/queries";
import {
  loadShortlistHarness,
  HarnessNotProvisionedError,
} from "@/lib/shortlist/harness";
import { runShortlistSourcing } from "@/lib/shortlist/run";
import { budgetReached } from "@/lib/shortlist/budget";

export const maxDuration = 600; // sourcing loops run long; work happens in after()

/** Sum of cost_usd across this project's prior shortlist runs (budget tracking). */
async function priorSpendUsd(projectId: string): Promise<number> {
  const { data } = await db()
    .from("shortlist_runs")
    .select("cost_usd")
    .eq("project_id", projectId);
  return (data ?? []).reduce(
    (sum, r) => sum + Number((r as { cost_usd: number | null }).cost_usd ?? 0),
    0,
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const projectId = String(body?.projectId ?? "");

  const project = await getProject(session.workspaceId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (project.status !== "active") {
    return NextResponse.json(
      { error: "This project is archived" },
      { status: 400 },
    );
  }

  // Provider + spend gates (mirrors the sourcing-plan route).
  const resolved = await resolveRunProviders(session.workspaceId);
  const primary = resolved.providers[0];
  if (!env.mockAi && !primary) {
    return NextResponse.json(
      { error: "No AI provider configured. Add one in Settings → AI Providers." },
      { status: 402 },
    );
  }
  const spendGate = await checkBudgets(session.workspace, "byo");
  if (spendGate.blocked && spendGate.reason === "spend_limit") {
    return NextResponse.json({ error: spendGate.message }, { status: 402 });
  }
  const provider = env.mockAi ? "calyflow" : primary!.row.provider;
  const model = env.mockAi ? "mock-model" : primary!.model;
  const platformGate = await checkBudgets(session.workspace, "calyflow");
  if (
    !env.mockAi &&
    provider === "calyflow" &&
    platformGate.blocked &&
    platformGate.reason === "platform_credit"
  ) {
    return NextResponse.json({ error: platformGate.message }, { status: 402 });
  }

  // Shortlist budget gate (EUR → USD). Best-effort across runs: refuse to start a
  // new run once the project's cumulative sourcing spend has reached the budget.
  const budgetUsd = project.sourcing_budget_usd;
  if (budgetUsd != null && budgetUsd > 0) {
    const spent = await priorSpendUsd(projectId);
    if (budgetReached(spent, budgetUsd)) {
      return NextResponse.json(
        {
          error:
            `This project has reached its sourcing budget ($${budgetUsd.toFixed(2)}). ` +
            "Raise the budget to source more.",
        },
        { status: 402 },
      );
    }
  }

  // The harness (IP) must be provisioned, else a clear error.
  try {
    await loadShortlistHarness();
  } catch (err) {
    if (err instanceof HarnessNotProvisionedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Could not load the sourcing configuration." },
      { status: 500 },
    );
  }

  // One run at a time per project.
  const { data: active } = await db()
    .from("shortlist_runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (active) {
    return NextResponse.json(
      { error: "A sourcing run is already in progress for this project." },
      { status: 409 },
    );
  }

  const { data: run, error: insertError } = await db()
    .from("shortlist_runs")
    .insert({
      project_id: projectId,
      status: "running",
      provider,
      model,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (insertError || !run) {
    console.error("Shortlist: run insert failed", insertError);
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }
  const runId = run.id as string;

  // Do the long-running sourcing in the background so the tab can close.
  after(() =>
    runShortlistSourcing({
      workspace: session.workspace,
      project,
      userId: session.userId,
      runId,
      provider,
      model,
      apiKey: env.mockAi ? null : primary!.apiKey,
      goalQualified: project.sourcing_goal_qualified,
      budgetUsd,
    }).catch((err) => {
      console.error("Shortlist: background run threw", err);
    }),
  );

  return NextResponse.json({ runId });
}

/** Latest run for a project, for the UI to poll while sourcing. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  const project = await getProject(session.workspaceId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { data } = await db()
    .from("shortlist_runs")
    .select(
      "id, status, steps, output_text, error_message, candidates_added, qualified_after, created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ run: data ?? null });
}
