import "server-only";
import { db } from "../db";
import type { OutreachDraft } from "../types";

/** All outreach drafts for a project, newest first. */
export async function listOutreachDrafts(
  projectId: string,
): Promise<OutreachDraft[]> {
  const { data, error } = await db()
    .from("outreach_drafts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OutreachDraft[];
}
