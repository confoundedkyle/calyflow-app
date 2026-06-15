"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "../auth";
import { db } from "../db";
import { getWorkspaceWorkflow } from "../queries";
import { getPostHogClient } from "../posthog-server";

/** One-click import: snapshot copy — user edits never touch the library. */
export async function importWorkflowAction(libraryWorkflowId: string) {
  const session = await requireSession();
  const { data: library, error: libraryError } = await db()
    .from("library_workflows")
    .select("*")
    .eq("id", libraryWorkflowId)
    .single();
  if (libraryError || !library) throw new Error("Workflow not found");

  const { data: created, error } = await db()
    .from("workspace_workflows")
    .insert({
      workspace_id: session.workspaceId,
      library_workflow_id: library.id,
      name: library.name,
      prompt_template: library.prompt_template,
      imported_version: library.version,
    })
    .select("id")
    .single();
  if (error) throw error;
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "workflow_imported",
    properties: {
      workflow_id: created.id,
      library_workflow_id: libraryWorkflowId,
      workflow_name: library.name,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath("/workflows");
  revalidatePath("/library");
  redirect(`/workflows?imported=${created.id}`);
}

/** Create a custom workflow from scratch — no library link. */
export async function createWorkflowAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const promptTemplate = String(formData.get("promptTemplate") ?? "");
  if (!name) throw new Error("Name is required");

  const { data, error } = await db()
    .from("workspace_workflows")
    .insert({
      workspace_id: session.workspaceId,
      name,
      prompt_template: promptTemplate,
    })
    .select("id")
    .single();
  if (error) throw error;
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "workflow_created",
    properties: {
      workflow_id: data.id,
      workflow_name: name,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath("/workflows");
  redirect(`/workflows/${data.id}`);
}

export async function updateWorkflowAction(formData: FormData) {
  const session = await requireSession();
  const workflowId = String(formData.get("workflowId"));
  const name = String(formData.get("name") ?? "").trim();
  const promptTemplate = String(formData.get("promptTemplate") ?? "");
  if (!name) throw new Error("Name is required");
  const workflow = await getWorkspaceWorkflow(session.workspaceId, workflowId);
  if (!workflow) throw new Error("Workflow not found");
  const { error } = await db()
    .from("workspace_workflows")
    .update({ name, prompt_template: promptTemplate })
    .eq("id", workflowId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/workflows/${workflowId}`);
}

/** Opt-in upgrade to the latest library version (SPEC §4). */
export async function upgradeWorkflowAction(workflowId: string) {
  const session = await requireSession();
  const workflow = await getWorkspaceWorkflow(session.workspaceId, workflowId);
  if (!workflow?.library) throw new Error("Workflow not found");
  const { error } = await db()
    .from("workspace_workflows")
    .update({
      prompt_template: workflow.library.prompt_template,
      imported_version: workflow.library.version,
    })
    .eq("id", workflowId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/workflows/${workflowId}`);
}

/** Soft-archive: the workflow leaves lists/pickers but its run history stays
 *  intact (workflow_runs reference workspace_workflows without a cascade). */
export async function archiveWorkflowAction(workflowId: string) {
  const session = await requireSession();
  const { error } = await db()
    .from("workspace_workflows")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", workflowId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/workflows/${workflowId}`);
}

export async function restoreWorkflowAction(workflowId: string) {
  const session = await requireSession();
  const { error } = await db()
    .from("workspace_workflows")
    .update({ archived_at: null })
    .eq("id", workflowId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/workflows/${workflowId}`);
}

export async function deleteWorkflowAction(workflowId: string) {
  const session = await requireSession();
  const workflow = await getWorkspaceWorkflow(session.workspaceId, workflowId);
  if (!workflow) throw new Error("Workflow not found");
  const { count } = await db()
    .from("workflow_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_workflow_id", workflowId);
  if (count && count > 0) {
    throw new Error("This workflow has runs — archive it instead");
  }
  const { error } = await db()
    .from("workspace_workflows")
    .delete()
    .eq("id", workflowId);
  if (error) throw error;
  revalidatePath("/workflows");
  redirect("/workflows");
}
