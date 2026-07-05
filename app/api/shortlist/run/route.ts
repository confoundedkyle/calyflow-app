import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkBudgets } from "@/lib/budgets";
import { resolveRunProviders } from "@/lib/providers";
import { getProject, getSessionTargets } from "@/lib/queries";
import {
  loadShortlistHarness,
  HarnessNotProvisionedError,
} from "@/lib/shortlist/harness";
import { runShortlistSourcing } from "@/lib/shortlist/run";
import {
  budgetReached,
  effectiveProjectBudgetUsd,
  effectiveSessionGoal,
  effectiveSessionBudgetUsd,
} from "@/lib/shortlist/budget";
import {
  staleShortlistRunCutoff,
  STALE_SHORTLIST_RUN_MESSAGE,
} from "@/lib/shortlist/stale-runs";

export const maxDuration = 600; // sourcing loops run long; work happens in after()

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function failStaleRunningRuns(projectId: string): Promise<void> {
  const cutoff = staleShortlistRunCutoff().toISOString();
  const { error } = await db()
    .from("shortlist_runs")
    .update({
      status: "failed",
      error_message: STALE_SHORTLIST_RUN_MESSAGE,
    })
    .eq("project_id", projectId)
    .eq("status", "running")
    .lt("created_at", cutoff);
  if (error) {
    console.warn("Shortlist: stale run cleanup failed:", error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const projectId = String(body?.projectId ?? "");
  // Optional recruiter-approved strategy (from the Sourcing tab's propose→approve
  // flow). Recorded on the run and threaded into the harness as the wave's guide.
  const strategy =
    typeof body?.strategy === "string" && body.strategy.trim()
      ? body.strategy.trim().slice(0, 8000)
      : null;
  // The session (strategist conversation) this run belongs to — drives the
  // session's own goal + budget.
  const conversationId =
    typeof body?.conversationId === "string" && UUID_RE.test(body.conversationId)
      ? body.conversationId
      : null;

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

  // Project-level cap (Project Settings, defaults to $10): refuse to start once
  // the project's cumulative sourcing spend across ALL sessions has reached it.
  const projectCap = effectiveProjectBudgetUsd(project.sourcing_budget_usd);
  const projectSpent = await priorSpendUsd(projectId);
  if (budgetReached(projectSpent, projectCap)) {
    return NextResponse.json(
      {
        error:
          `This project has reached its sourcing budget ($${projectCap.toFixed(2)}). ` +
          "Raise it in Project Settings to source more.",
      },
      { status: 402 },
    );
  }

  // Per-session goal + budget (from the strategist conversation). The run pursues
  // the session's goal within the smaller of the session budget and the remaining
  // project cap.
  const sessionTargets = await getSessionTargets(projectId, conversationId);
  const remainingProjectCap = Math.max(projectCap - projectSpent, 0);
  // Unset session goal/budget fall back to sensible defaults (5 qualified, $3),
  // and the budget is still clamped to what's left of the project cap.
  const sessionGoal = effectiveSessionGoal(sessionTargets.goalQualified);
  const budgetUsd = Math.min(
    effectiveSessionBudgetUsd(sessionTargets.budgetUsd),
    remainingProjectCap,
  );

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

  // One run at a time per project. A background run should finish inside the
  // route's 600s budget; anything much older is a stranded row from a killed
  // worker/browser session and should not block the recruiter forever.
  await failStaleRunningRuns(projectId);
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
      strategy,
      conversation_id: conversationId,
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
      conversationId,
      goalQualified: sessionGoal,
      budgetUsd,
      guideline: strategy,
    }).catch((err) => {
      console.error("Shortlist: background run threw", err);
    }),
  );

  return NextResponse.json({ runId });
}

/** Run status for the UI to poll while sourcing. Prefer a specific run id so a
 *  newly-approved session never renders another session's trace. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  const runId = request.nextUrl.searchParams.get("runId") ?? "";
  const conversationId = request.nextUrl.searchParams.get("conversationId") ?? "";
  const project = await getProject(session.workspaceId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await failStaleRunningRuns(projectId);
  let query = db()
    .from("shortlist_runs")
    .select(
      "id, status, steps, output_text, error_message, candidates_added, qualified_after, outcome, learnings, cost_usd, input_tokens, output_tokens, cache_read_tokens, created_at, conversation_id, strategy",
    )
    .eq("project_id", projectId);

  if (UUID_RE.test(runId)) {
    query = query.eq("id", runId);
  } else if (UUID_RE.test(conversationId)) {
    query = query.eq("conversation_id", conversationId);
  }

  const { data } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ run: data ?? null });
}
