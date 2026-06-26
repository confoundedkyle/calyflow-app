import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkBudgets } from "@/lib/budgets";
import { resolveRunProviders } from "@/lib/providers";
import { getProject } from "@/lib/queries";
import {
  loadOutreachHarness,
  HarnessNotProvisionedError,
} from "@/lib/outreach/harness";
import { runOutreachDrafting } from "@/lib/outreach/run";

export const maxDuration = 600; // drafting runs long; work happens in after()

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

  // Provider + spend gates (mirrors the shortlist route).
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

  // The harness (IP) must be provisioned, else a clear error.
  try {
    await loadOutreachHarness();
  } catch (err) {
    if (err instanceof HarnessNotProvisionedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Could not load the outreach configuration." },
      { status: 500 },
    );
  }

  // One drafting run at a time per project.
  const { data: active } = await db()
    .from("outreach_runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (active) {
    return NextResponse.json(
      { error: "A drafting run is already in progress for this project." },
      { status: 409 },
    );
  }

  const { data: run, error: insertError } = await db()
    .from("outreach_runs")
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
    console.error("Outreach: run insert failed", insertError);
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }
  const runId = run.id as string;

  // Draft in the background so the tab can close.
  after(() =>
    runOutreachDrafting({
      workspace: session.workspace,
      project,
      userId: session.userId,
      runId,
      provider,
      model,
      apiKey: env.mockAi ? null : primary!.apiKey,
    }).catch((err) => {
      console.error("Outreach: background run threw", err);
    }),
  );

  return NextResponse.json({ runId });
}

/** Latest drafting run for a project, for the UI to poll. */
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
    .from("outreach_runs")
    .select(
      "id, status, steps, output_text, error_message, drafts_created, created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ run: data ?? null });
}
