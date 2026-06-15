"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "../auth";
import { db } from "../db";
import { getWorkspaceAgent } from "../queries";
import { getPostHogClient } from "../posthog-server";

/** One-click import: snapshot copy of a library agent into the workspace. */
export async function importAgentAction(libraryAgentId: string) {
  const session = await requireSession();
  const { data: library, error: libraryError } = await db()
    .from("library_agents")
    .select("*")
    .eq("id", libraryAgentId)
    .single();
  if (libraryError || !library) throw new Error("Agent not found");

  const { error } = await db()
    .from("workspace_agents")
    .insert({
      workspace_id: session.workspaceId,
      library_agent_id: library.id,
      name: library.name,
      instructions: library.instructions,
      allowed_tools: library.allowed_tools,
      model: library.model,
      max_steps: library.max_steps,
      imported_version: library.version,
    });
  if (error) throw error;
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "agent_imported",
    properties: {
      library_agent_id: libraryAgentId,
      agent_name: library.name,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath("/");
}

/** Soft-archive: the agent leaves lists/pickers but its run history stays
 *  intact (agent_runs reference workspace_agents without a cascade). */
export async function archiveAgentAction(agentId: string) {
  const session = await requireSession();
  const { error } = await db()
    .from("workspace_agents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", agentId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
}

export async function restoreAgentAction(agentId: string) {
  const session = await requireSession();
  const { error } = await db()
    .from("workspace_agents")
    .update({ archived_at: null })
    .eq("id", agentId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/agents/${agentId}`);
}

/** Edit a workspace agent's name and instructions (its "skill"). */
export async function updateAgentAction(formData: FormData) {
  const session = await requireSession();
  const agentId = String(formData.get("agentId"));
  const name = String(formData.get("name") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "");
  if (!name) throw new Error("Name is required");
  const agent = await getWorkspaceAgent(session.workspaceId, agentId);
  if (!agent) throw new Error("Agent not found");
  const { error } = await db()
    .from("workspace_agents")
    .update({ name, instructions })
    .eq("id", agentId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/agents/${agentId}`);
}

/** Opt-in upgrade: pull the latest library instructions into this copy. */
export async function upgradeAgentAction(agentId: string) {
  const session = await requireSession();
  const agent = await getWorkspaceAgent(session.workspaceId, agentId);
  if (!agent?.library_agent_id) throw new Error("Agent not found");
  const { data: library } = await db()
    .from("library_agents")
    .select("instructions, allowed_tools, model, max_steps, version")
    .eq("id", agent.library_agent_id)
    .single();
  if (!library) throw new Error("Library agent not found");
  const { error } = await db()
    .from("workspace_agents")
    .update({
      instructions: library.instructions,
      allowed_tools: library.allowed_tools,
      model: library.model,
      max_steps: library.max_steps,
      imported_version: library.version,
    })
    .eq("id", agentId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/agents/${agentId}`);
}

export async function deleteAgentAction(agentId: string) {
  const session = await requireSession();
  const agent = await getWorkspaceAgent(session.workspaceId, agentId);
  if (!agent) throw new Error("Agent not found");
  const { count } = await db()
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_agent_id", agentId);
  if (count && count > 0) {
    throw new Error("This agent has runs — archive it instead");
  }
  const { error } = await db()
    .from("workspace_agents")
    .delete()
    .eq("id", agentId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
  redirect("/workflows");
}
