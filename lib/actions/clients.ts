"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "../auth";
import { db } from "../db";
import { getClient, getProject } from "../queries";
import { getPostHogClient } from "../posthog-server";

export async function createClientAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Client name is required");
  const { data, error } = await db()
    .from("clients")
    .insert({ workspace_id: session.workspaceId, name })
    .select("id")
    .single();
  if (error) throw error;
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "client_created",
    properties: { client_id: data.id, workspace_id: session.workspaceId },
  });
  revalidatePath("/clients");
  redirect(`/clients/${data.id}`);
}

export async function createProjectAction(formData: FormData) {
  const session = await requireSession();
  const clientId = String(formData.get("clientId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Project name is required");
  const client = await getClient(session.workspaceId, clientId);
  if (!client) throw new Error("Client not found");
  const { data, error } = await db()
    .from("projects")
    .insert({ client_id: clientId, name })
    .select("id")
    .single();
  if (error) throw error;
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "project_created",
    properties: {
      project_id: data.id,
      client_id: clientId,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}/projects/${data.id}`);
}

export async function renameClientAction(clientId: string, name: string) {
  const session = await requireSession();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Client name is required");
  const client = await getClient(session.workspaceId, clientId);
  if (!client) throw new Error("Client not found");
  const { error } = await db()
    .from("clients")
    .update({ name: trimmed })
    .eq("id", clientId);
  if (error) throw error;
  // "layout" so the sidebar client tree refreshes too.
  revalidatePath("/", "layout");
}

export async function setClientStatusAction(
  clientId: string,
  status: "active" | "archived",
) {
  const session = await requireSession();
  const client = await getClient(session.workspaceId, clientId);
  if (!client) throw new Error("Client not found");
  const { error } = await db()
    .from("clients")
    .update({ status })
    .eq("id", clientId);
  if (error) throw error;
  revalidatePath("/", "layout");
}

/** Deleting is blocked while projects exist — archiving is the safe path. */
export async function deleteClientAction(clientId: string) {
  const session = await requireSession();
  const client = await getClient(session.workspaceId, clientId);
  if (!client) throw new Error("Client not found");

  const { count } = await db()
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (count && count > 0) {
    throw new Error(
      "This client still has projects. Keep it archived instead.",
    );
  }

  // Remove client-scoped documents (KB + files) and their stored uploads.
  const { data: docs } = await db()
    .from("documents")
    .select("id, storage_path")
    .eq("workspace_id", session.workspaceId)
    .eq("scope_type", "client")
    .eq("scope_id", clientId);
  const paths = (docs ?? [])
    .map((d) => d.storage_path)
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await db().storage.from("documents").remove(paths);
  }
  await db()
    .from("documents")
    .delete()
    .eq("workspace_id", session.workspaceId)
    .eq("scope_type", "client")
    .eq("scope_id", clientId);

  const { error } = await db().from("clients").delete().eq("id", clientId);
  if (error) throw error;
  revalidatePath("/", "layout");
}

export async function setProjectStatusAction(
  projectId: string,
  status: "active" | "archived",
) {
  const session = await requireSession();
  const project = await getProject(session.workspaceId, projectId);
  if (!project) throw new Error("Project not found");
  const { error } = await db()
    .from("projects")
    .update({ status })
    .eq("id", projectId);
  if (error) throw error;
  revalidatePath(`/clients/${project.client_id}`);
  revalidatePath(`/clients/${project.client_id}/projects/${projectId}`);
}
