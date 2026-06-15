"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getProspect } from "../queries";
import { LINKEDIN_URL_ERROR, isValidLinkedinUrl } from "../validation";

export async function createProspectAction(formData: FormData): Promise<string> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Prospect name is required");
  const linkedin = optional(formData.get("linkedin_url"));
  if (!isValidLinkedinUrl(linkedin)) throw new Error(LINKEDIN_URL_ERROR);
  const { data, error } = await db()
    .from("talent_prospects")
    .insert({
      workspace_id: session.workspaceId,
      name,
      email: optional(formData.get("email")),
      phone: optional(formData.get("phone")),
      country: optional(formData.get("country")),
      city: optional(formData.get("city")),
      linkedin_url: linkedin,
      notes: optional(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/talent-pool");
  return data.id;
}

export async function updateProspectAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Prospect name is required");
  const prospect = await getProspect(session.workspaceId, id);
  if (!prospect) throw new Error("Prospect not found");
  const linkedin = optional(formData.get("linkedin_url"));
  if (!isValidLinkedinUrl(linkedin)) throw new Error(LINKEDIN_URL_ERROR);
  const { error } = await db()
    .from("talent_prospects")
    .update({
      name,
      email: optional(formData.get("email")),
      phone: optional(formData.get("phone")),
      country: optional(formData.get("country")),
      city: optional(formData.get("city")),
      linkedin_url: linkedin,
      notes: optional(formData.get("notes")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/talent-pool");
  revalidatePath(`/talent-pool/${id}`);
}

export async function deleteProspectAction(prospectId: string) {
  const session = await requireSession();
  const prospect = await getProspect(session.workspaceId, prospectId);
  if (!prospect) throw new Error("Prospect not found");

  // Remove any prospect-scoped documents (CVs) and their stored uploads.
  const { data: docs } = await db()
    .from("documents")
    .select("id, storage_path")
    .eq("workspace_id", session.workspaceId)
    .eq("scope_type", "prospect")
    .eq("scope_id", prospectId);
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
    .eq("scope_type", "prospect")
    .eq("scope_id", prospectId);

  const { error } = await db()
    .from("talent_prospects")
    .delete()
    .eq("id", prospectId);
  if (error) throw error;
  revalidatePath("/talent-pool");
}

function optional(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}
