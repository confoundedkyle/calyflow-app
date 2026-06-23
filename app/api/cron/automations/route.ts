import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import {
  getWorkspaceServiceUserId,
  listAutomationsDue,
} from "@/lib/queries";
import { runAgentHeadless } from "@/lib/agents/run";
import { computeNextRun } from "@/lib/automations";
import { expandConnectorPlaceholders } from "@/lib/connectors";
import { ALL_TOOL_NAMES } from "@/lib/agents/tools";
import { db } from "@/lib/db";

export const maxDuration = 600; // running several automations can take a while

// ⚠️ Automation Hub execution — BUILT BUT NOT YET ACTIVATED.
// This route runs due workspace_automations headlessly, mirroring the
// slack-reports cron. It is intentionally NOT wired to Cloud Scheduler yet, and
// requires an explicit `?live=1` to actually execute (otherwise it returns a
// dry-run preview). Follow-up: register a Cloud Scheduler job and drop the
// live-gate to make automations run for real.

function authorized(header: string): boolean {
  if (!env.cronSecret) return false;
  const expected = `Bearer ${env.cronSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get("authorization") ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const live = request.nextUrl.searchParams.get("live") === "1";
  const now = new Date();

  let due;
  try {
    due = await listAutomationsDue(now);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 502 },
    );
  }

  // Dry-run: list what WOULD execute without running anything.
  if (!live) {
    return NextResponse.json({
      ok: true,
      live: false,
      note: "Dry run — pass ?live=1 to execute. Not yet wired to Cloud Scheduler.",
      due: due.map((a) => ({
        id: a.id,
        name: a.name,
        bindings: a.connector_bindings,
        schedule: a.schedule,
      })),
    });
  }

  const results: { automation: string; status: string }[] = [];
  for (const automation of due) {
    try {
      const allowed = expandConnectorPlaceholders(
        automation.allowed_tools ?? [],
        automation.connector_bindings ?? {},
        ALL_TOOL_NAMES,
      );
      const userId = await getWorkspaceServiceUserId(automation.workspace_id);
      const run = await runAgentHeadless({
        workspaceId: automation.workspace_id,
        userId,
        project: null,
        agent: {
          id: automation.id,
          name: automation.name,
          instructions: automation.instructions,
          allowed_tools: allowed,
          model: automation.model,
          max_steps: automation.max_steps,
        },
        task: automation.library?.task ?? undefined,
        workspaceAutomationId: automation.id,
      });
      await db()
        .from("workspace_automations")
        .update({
          status: run.succeeded ? "healthy" : "failed",
          last_run_at: now.toISOString(),
          next_run_at:
            computeNextRun(automation.schedule, now)?.toISOString() ?? null,
        })
        .eq("id", automation.id);
      results.push({
        automation: automation.id,
        status: run.succeeded ? "ran" : `run-failed:${run.error ?? "?"}`,
      });
    } catch (error) {
      results.push({
        automation: automation.id,
        status: `error:${error instanceof Error ? error.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    live: true,
    ran: results.filter((r) => r.status === "ran").length,
    results,
  });
}
