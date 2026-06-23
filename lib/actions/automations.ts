"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "../auth";
import { db } from "../db";
import { getLibraryAutomation, getWorkspaceAutomation } from "../queries";
import { computeNextRun } from "../automations";
import { getPostHogClient } from "../posthog-server";
import {
  connectorsForCategory,
  requiredConnectorCategories,
} from "../connectors";
import type { AutomationSchedule, AutomationScheduleKind } from "../types";

/** One-click import: snapshot copy of a library automation into the workspace,
 *  disabled, pre-filled with the library's default schedule. */
export async function importAutomationAction(libraryAutomationId: string) {
  const session = await requireSession();
  const library = await getLibraryAutomation(libraryAutomationId);
  if (!library) throw new Error("Automation not found");

  const { data, error } = await db()
    .from("workspace_automations")
    .insert({
      workspace_id: session.workspaceId,
      library_automation_id: library.id,
      name: library.name,
      instructions: library.instructions,
      allowed_tools: library.allowed_tools,
      model: library.model,
      max_steps: library.max_steps,
      imported_version: library.version,
      schedule: library.default_schedule,
      enabled: false,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Could not import automation");

  getPostHogClient().capture({
    distinctId: session.userId,
    event: "automation_imported",
    properties: {
      library_automation_id: libraryAutomationId,
      automation_name: library.name,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath("/automation-hub");
  redirect(`/automation-hub/${data.id}/configure`);
}

function parseSchedule(formData: FormData): AutomationSchedule {
  const kind = String(formData.get("schedule_kind") ?? "daily") as
    | AutomationScheduleKind;
  if (kind === "daily" || kind === "weekly") {
    const time = String(formData.get("schedule_time") ?? "06:00").trim();
    return { kind, time: /^\d{2}:\d{2}$/.test(time) ? time : "06:00" };
  }
  return { kind };
}

/** Save connector bindings + schedule for a configured automation. */
export async function configureAutomationAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("automationId"));
  const automation = await getWorkspaceAutomation(session.workspaceId, id);
  if (!automation) throw new Error("Automation not found");

  // Bind one provider per required category, validating it's a real connector
  // of that category.
  const bindings: Record<string, string> = {};
  for (const category of requiredConnectorCategories(
    automation.allowed_tools ?? [],
  )) {
    const provider = String(formData.get(`connector_${category}`) ?? "").trim();
    if (!provider) continue;
    if (
      connectorsForCategory(category).some((c) => c.provider === provider)
    ) {
      bindings[category] = provider;
    }
  }

  const schedule = parseSchedule(formData);
  const enabled = formData.get("enabled") === "on";

  const { error } = await db()
    .from("workspace_automations")
    .update({
      connector_bindings: bindings,
      schedule,
      enabled,
      next_run_at: enabled
        ? (computeNextRun(schedule, new Date())?.toISOString() ?? null)
        : null,
    })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;

  getPostHogClient().capture({
    distinctId: session.userId,
    event: "automation_configured",
    properties: {
      automation_id: id,
      enabled,
      schedule_kind: schedule.kind,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath("/automation-hub");
  redirect("/automation-hub");
}

/** Toggle an automation on/off from the Hub. */
export async function setAutomationEnabledAction(
  id: string,
  enabled: boolean,
) {
  const session = await requireSession();
  const automation = await getWorkspaceAutomation(session.workspaceId, id);
  if (!automation) throw new Error("Automation not found");
  const { error } = await db()
    .from("workspace_automations")
    .update({
      enabled,
      next_run_at: enabled
        ? (computeNextRun(automation.schedule, new Date())?.toISOString() ?? null)
        : null,
    })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/automation-hub");
}

/** Soft-archive: the automation leaves the Hub but its run history stays. */
export async function archiveAutomationAction(id: string) {
  const session = await requireSession();
  const { error } = await db()
    .from("workspace_automations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/automation-hub");
}
