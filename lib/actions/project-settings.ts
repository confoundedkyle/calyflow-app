"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getValidAccessToken } from "../integrations";
import { slackAdapter } from "../integrations/slack";
import { getConnection, getProject } from "../queries";
import type { ReportFrequency } from "../types";

const REPORT_AGENT_SLUG = "slack-daily-report";
const FREQUENCIES: ReportFrequency[] = ["off", "daily", "weekly"];

/** Slack channel names: lowercase, no spaces, hyphen-separated, ≤80 chars. */
function slugifyChannel(name: string): string {
  return (
    "proj-" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70)
  );
}

/** Import the daily-report agent into the workspace if it has no copy yet, so
 *  the cron can run it. Idempotent — called when a project turns reporting on. */
async function ensureReportAgentImported(workspaceId: string): Promise<void> {
  const { data: library } = await db()
    .from("library_agents")
    .select("*")
    .eq("slug", REPORT_AGENT_SLUG)
    .maybeSingle();
  if (!library) return; // not seeded yet — nothing to import

  const { data: existing } = await db()
    .from("workspace_agents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("library_agent_id", library.id)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  await db().from("workspace_agents").insert({
    workspace_id: workspaceId,
    library_agent_id: library.id,
    name: library.name,
    instructions: library.instructions,
    allowed_tools: library.allowed_tools,
    model: library.model,
    max_steps: library.max_steps,
    imported_version: library.version,
  });
}

/** Save a project's Slack channel + report cadence (Project → Settings). */
export async function updateProjectSlackSettingsAction(
  projectId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const project = await getProject(session.workspaceId, projectId);
  if (!project) throw new Error("Project not found");

  // The channel field is "id|name" from the picker (Slack channel names can't
  // contain "|"), or a bare channel id typed into the manual fallback.
  const channelRaw = String(formData.get("slackChannel") ?? "").trim();
  const [rawId, rawName] = channelRaw.split("|");
  const channelId = rawId?.trim() || null;
  const channelName = rawName?.trim() || null;
  const freqRaw = String(formData.get("reportFrequency") ?? "off");
  const reportFrequency: ReportFrequency = FREQUENCIES.includes(
    freqRaw as ReportFrequency,
  )
    ? (freqRaw as ReportFrequency)
    : "off";

  if (reportFrequency !== "off" && !channelId) {
    throw new Error("Pick a Slack channel before turning on reports.");
  }

  const { error } = await db()
    .from("projects")
    .update({
      slack_channel_id: channelId,
      slack_channel_name: channelName,
      report_frequency: reportFrequency,
    })
    .eq("id", projectId);
  if (error) throw error;

  if (reportFrequency !== "off") {
    await ensureReportAgentImported(session.workspaceId);
  }
  revalidatePath(
    `/clients/${project.client_id}/projects/${projectId}/settings`,
  );
}

/** Create a dedicated public Slack channel for this project and map it. Gives
 *  the "one channel per project" flow a one-click path. */
export async function createProjectChannelAction(
  projectId: string,
): Promise<void> {
  const session = await requireSession();
  const project = await getProject(session.workspaceId, projectId);
  if (!project) throw new Error("Project not found");

  const connection = await getConnection(session.workspaceId, "slack");
  if (!connection || connection.status !== "active") {
    throw new Error("Connect Slack first in Settings → Connectors.");
  }
  const token = await getValidAccessToken(connection);
  let id: string;
  let name: string;
  try {
    ({ id, name } = await slackAdapter.createChannel(
      token,
      slugifyChannel(project.name),
    ));
  } catch (err) {
    // The channel-creation scope (channels:manage) was added after the first
    // Slack apps were connected — a workspace linked before then can't create
    // channels until it reconnects to grant it. Turn Slack's raw "missing_scope"
    // into an actionable message; pick an existing channel as the alternative.
    if (err instanceof Error && err.message.includes("missing_scope")) {
      throw new Error(
        "Slack needs the “channels:manage” permission to create a channel. " +
          "Reconnect Slack in Settings → Connectors to grant it, or pick an " +
          "existing channel above.",
      );
    }
    throw err;
  }

  const { error } = await db()
    .from("projects")
    .update({ slack_channel_id: id, slack_channel_name: name })
    .eq("id", projectId);
  if (error) throw error;
  revalidatePath(
    `/clients/${project.client_id}/projects/${projectId}/settings`,
  );
}
