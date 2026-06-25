import "server-only";
import { randomUUID } from "crypto";
import { db } from "../db";

/** Archive the project's current active qualification criteria (one active per
 *  project, like the sourcing-plan / JD idiom). History is kept. */
async function archivePrevious(projectId: string) {
  await db()
    .from("documents")
    .update({ is_active: false })
    .eq("scope_type", "project")
    .eq("scope_id", projectId)
    .eq("doc_type", "qualification")
    .eq("is_active", true);
}

/** Persist generated/revised qualification criteria as the project's single
 *  active `qualification` document and return its id. Source-less markdown, so
 *  it's inline-editable via updateDocumentTextAction. */
export async function saveQualification(
  workspaceId: string,
  projectId: string,
  userId: string,
  markdown: string,
): Promise<string> {
  await archivePrevious(projectId);
  const id = randomUUID();
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const { error } = await db().from("documents").insert({
    id,
    scope_type: "project",
    scope_id: projectId,
    workspace_id: workspaceId,
    kind: "file",
    doc_type: "qualification",
    source: "agent",
    filename: `Qualification criteria – ${date}.md`,
    extracted_text: markdown,
    created_by: userId,
  });
  if (error) throw error;
  return id;
}
