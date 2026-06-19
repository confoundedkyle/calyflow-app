import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import {
  getWorkspaceAgentByLibrarySlug,
  getWorkspaceServiceUserId,
  listProjectsDueForReport,
} from "@/lib/queries";
import { runAgentHeadless } from "@/lib/agents/run";
import { postToChannel } from "@/lib/slack";
import { db } from "@/lib/db";

export const maxDuration = 600; // running several agents can take a while

// Hour (UTC) at which daily/weekly reports go out. The scheduler pings this
// route hourly; we only act in this hour so reports land at a predictable time
// regardless of how often the scheduler fires.
const REPORT_HOUR_UTC = 8;

function authorized(header: string): boolean {
  if (!env.cronSecret) return false;
  const expected = `Bearer ${env.cronSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a project is due to report now, given its cadence and last send. */
function isDue(
  frequency: string,
  lastSentAt: string | null,
  now: Date,
  force: boolean,
): boolean {
  const hoursSince = lastSentAt
    ? (now.getTime() - Date.parse(lastSentAt)) / 3_600_000
    : Infinity;
  if (force) return hoursSince >= 1; // testing: ignore the hour/day gate
  if (now.getUTCHours() !== REPORT_HOUR_UTC) return false;
  if (frequency === "daily") return hoursSince >= 20;
  if (frequency === "weekly") return now.getUTCDay() === 1 && hoursSince >= 24 * 6;
  return false;
}

// Scheduled Slack project reports. Triggered by Cloud Scheduler hourly with
// `Authorization: Bearer ${CRON_SECRET}` (same mechanism as sync-models). Fans
// out across every workspace, so it runs service-role and is NOT
// workspace-scoped — the auth is the bearer token.
export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get("authorization") ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = request.nextUrl.searchParams.get("force") === "1";
  const now = new Date();

  let projects;
  try {
    projects = await listProjectsDueForReport();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 502 },
    );
  }

  const results: { project: string; status: string }[] = [];

  for (const project of projects) {
    if (!project.slack_channel_id) continue;
    if (!isDue(project.report_frequency, project.report_last_sent_at, now, force)) {
      continue;
    }
    const workspaceId = project.client.workspace_id;
    try {
      const agent = await getWorkspaceAgentByLibrarySlug(
        workspaceId,
        "slack-daily-report",
      );
      if (!agent) {
        results.push({ project: project.id, status: "no-agent" });
        continue;
      }
      const userId = await getWorkspaceServiceUserId(workspaceId);
      const run = await runAgentHeadless({
        workspaceId,
        userId,
        project,
        agent,
        task:
          "Write the scheduled status update for this project's hiring manager, " +
          "to be posted in Slack now.",
      });
      if (!run.succeeded || !run.outputText.trim()) {
        results.push({ project: project.id, status: `run-failed:${run.error ?? "empty"}` });
        continue;
      }
      const posted = await postToChannel(
        workspaceId,
        project.slack_channel_id,
        run.outputText,
      );
      if (!posted.ok) {
        results.push({ project: project.id, status: `post-failed:${posted.reason ?? "?"}` });
        continue;
      }
      await db()
        .from("projects")
        .update({ report_last_sent_at: now.toISOString() })
        .eq("id", project.id);
      results.push({ project: project.id, status: "sent" });
    } catch (error) {
      results.push({
        project: project.id,
        status: `error:${error instanceof Error ? error.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json({ ok: true, sent: results.filter((r) => r.status === "sent").length, results });
}
