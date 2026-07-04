"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { env } from "../env";
import { extractTextFromFile } from "../extract";
import { firecrawlScrape } from "../integrations/firecrawl";
import { getClient, getDocument, getProject, getProspect } from "../queries";
import type { DocKind, DocScope, DocType, Session } from "../types";

const DOC_TYPE_LABELS: Record<string, string> = {
  jd: "JD",
  intake_notes: "Intake notes",
  cv: "CV",
  scorecard: "Scorecard",
  note: "Note",
  sourcing_plan: "Sourcing plan",
  other: "Document",
};

async function assertScope(
  session: Session,
  scopeType: DocScope,
  scopeId: string,
) {
  if (scopeType === "workspace") {
    if (scopeId !== session.workspaceId) throw new Error("Invalid scope");
  } else if (scopeType === "client") {
    if (!(await getClient(session.workspaceId, scopeId)))
      throw new Error("Client not found");
  } else if (scopeType === "prospect") {
    if (!(await getProspect(session.workspaceId, scopeId)))
      throw new Error("Connection not found");
  } else {
    if (!(await getProject(session.workspaceId, scopeId)))
      throw new Error("Project not found");
  }
}

/** One active JD per project: pasting a new JD archives the old (SPEC §4). */
async function archivePreviousJd(scopeId: string) {
  await db()
    .from("documents")
    .update({ is_active: false })
    .eq("scope_type", "project")
    .eq("scope_id", scopeId)
    .eq("doc_type", "jd")
    .eq("is_active", true);
}

function autoFilename(docType: DocType | null, source: "pasted" | "upload") {
  const label = DOC_TYPE_LABELS[docType ?? "other"] ?? "Document";
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return `${label} – ${source} ${date}`;
}

/**
 * Supabase Storage rejects object keys with non-ASCII or special characters
 * (e.g. the em-dash in "CV Screener — 10 Jun.md"). Sanitise only the storage
 * key — the original `file.name` is kept verbatim in the `filename` column for
 * display. A UUID prefix guarantees uniqueness, so collisions aren't a concern.
 */
function storageSafeName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "") // drop non-ASCII (dashes, accents, …)
      .replace(/[^a-zA-Z0-9._-]/g, "-") // conservative whitelist
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "file"
  );
}

async function revalidateScope(
  workspaceId: string,
  scopeType: DocScope,
  scopeId: string,
) {
  // "layout" so the sub-tabs (/knowledge + /files) refresh too.
  if (scopeType === "workspace") {
    revalidatePath("/knowledge", "layout");
  } else if (scopeType === "client") {
    revalidatePath(`/clients/${scopeId}`, "layout");
  } else if (scopeType === "prospect") {
    revalidatePath(`/talent-pool/${scopeId}`);
  } else {
    const project = await getProject(workspaceId, scopeId);
    // Revalidate the literal documents page for the current mutation, plus the
    // project layout pattern so readiness badges and agent tabs see the change.
    if (project) {
      revalidatePath(
        `/clients/${project.client.id}/projects/${project.id}/documents`,
      );
    }
    revalidatePath("/clients/[clientId]/projects/[projectId]", "layout");
  }
}

export async function createPastedDocumentAction(formData: FormData) {
  const session = await requireSession();
  const scopeType = String(formData.get("scopeType")) as DocScope;
  const scopeId = String(formData.get("scopeId"));
  const kind = (String(formData.get("kind") ?? "file") as DocKind) || "file";
  const docType = (String(formData.get("docType") ?? "other") ||
    "other") as DocType;
  const text = String(formData.get("text") ?? "").trim();
  const filename = String(formData.get("filename") ?? "").trim();
  if (!text) throw new Error("Paste some text first");

  await assertScope(session, scopeType, scopeId);
  if (scopeType === "project" && docType === "jd") {
    await archivePreviousJd(scopeId);
  }
  const { error } = await db().from("documents").insert({
    scope_type: scopeType,
    scope_id: scopeId,
    workspace_id: session.workspaceId,
    kind,
    doc_type: docType,
    source: "pasted",
    filename: filename || autoFilename(docType, "pasted"),
    extracted_text: text,
    created_by: session.userId,
  });
  if (error) throw error;
  await revalidateScope(session.workspaceId, scopeType, scopeId);
}

/**
 * Import a document by scraping a single web page to markdown (Firecrawl).
 * Mirrors the paste flow — the page is fetched by Firecrawl's API, not by us,
 * so there's no direct server-side SSRF surface; we still require a valid
 * http(s) URL. The scraped markdown is stored as the doc's text (no original
 * file, so no storage object).
 */
export async function importDocumentFromUrlAction(formData: FormData) {
  const session = await requireSession();
  const scopeType = String(formData.get("scopeType")) as DocScope;
  const scopeId = String(formData.get("scopeId"));
  const kind = (String(formData.get("kind") ?? "file") as DocKind) || "file";
  const docType = (String(formData.get("docType") ?? "other") ||
    "other") as DocType;
  const url = String(formData.get("url") ?? "").trim();
  const filename = String(formData.get("filename") ?? "").trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid URL (starting with https://).");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("Only http(s) URLs can be imported.");

  if (!env.firecrawlApiKey)
    throw new Error("URL import isn't configured on this deployment.");

  await assertScope(session, scopeType, scopeId);

  const { markdown, title } = await firecrawlScrape(env.firecrawlApiKey, {
    url,
  });
  if (!markdown.trim())
    throw new Error("Couldn't read any text from that page.");

  if (scopeType === "project" && docType === "jd") {
    await archivePreviousJd(scopeId);
  }
  const { error } = await db().from("documents").insert({
    scope_type: scopeType,
    scope_id: scopeId,
    workspace_id: session.workspaceId,
    kind,
    doc_type: docType,
    source: "url",
    filename: filename || title || autoFilename(docType, "pasted"),
    extracted_text: markdown,
    created_by: session.userId,
  });
  if (error) throw error;
  await revalidateScope(session.workspaceId, scopeType, scopeId);
}

export async function uploadDocumentAction(formData: FormData) {
  const session = await requireSession();
  const scopeType = String(formData.get("scopeType")) as DocScope;
  const scopeId = String(formData.get("scopeId"));
  const kind = (String(formData.get("kind") ?? "file") as DocKind) || "file";
  const docType = (String(formData.get("docType") ?? "other") ||
    "other") as DocType;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Choose a file first");
  if (file.size > 20 * 1024 * 1024) throw new Error("File too large (20 MB max)");

  await assertScope(session, scopeType, scopeId);
  const extractedText = await extractTextFromFile(file);

  const storagePath = `${session.workspaceId}/${scopeType}/${scopeId}/${randomUUID()}-${storageSafeName(file.name)}`;
  const { error: uploadError } = await db()
    .storage.from("documents")
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
    });
  if (uploadError) {
    console.error("uploadDocument: storage upload failed", uploadError);
    throw new Error(`Couldn't store “${file.name}”. Please try again.`);
  }

  if (scopeType === "project" && docType === "jd") {
    await archivePreviousJd(scopeId);
  }
  const { error } = await db().from("documents").insert({
    scope_type: scopeType,
    scope_id: scopeId,
    workspace_id: session.workspaceId,
    kind,
    doc_type: docType,
    source: "upload",
    filename: file.name,
    storage_path: storagePath,
    extracted_text: extractedText,
    created_by: session.userId,
  });
  if (error) {
    console.error("uploadDocument: insert failed", error);
    throw new Error(
      `Couldn't save “${file.name}”. The file may be corrupted or its text couldn't be read.`,
    );
  }
  await revalidateScope(session.workspaceId, scopeType, scopeId);
}

/** Client KB is a single free-text notes doc in V1 (SPEC §4 matrix). */
export async function saveClientKbAction(formData: FormData) {
  const session = await requireSession();
  const clientId = String(formData.get("clientId"));
  const text = String(formData.get("text") ?? "").trim();
  const client = await getClient(session.workspaceId, clientId);
  if (!client) throw new Error("Client not found");

  const { data: existing } = await db()
    .from("documents")
    .select("id")
    .eq("workspace_id", session.workspaceId)
    .eq("scope_type", "client")
    .eq("scope_id", clientId)
    .eq("kind", "kb")
    .maybeSingle();

  if (existing) {
    const { error } = await db()
      .from("documents")
      .update({ extracted_text: text })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await db().from("documents").insert({
      scope_type: "client",
      scope_id: clientId,
      workspace_id: session.workspaceId,
      kind: "kb",
      doc_type: "note",
      source: "pasted",
      filename: `${client.name} — client notes`,
      extracted_text: text,
      created_by: session.userId,
    });
    if (error) throw error;
  }
  revalidatePath(`/clients/${clientId}`, "layout");
}

/** Upload a CV and return its ID so the caller can immediately trigger a run. */
const RUN_INPUT_DOC_TYPES: DocType[] = [
  "cv",
  "intake_notes",
  "note",
  "scorecard",
  "other",
];

/** Upload a per-run input document (CV, intake notes, …) and return its id. */
export async function uploadInputForRunAction(
  formData: FormData,
): Promise<{ docId: string }> {
  const session = await requireSession();
  const scopeId = String(formData.get("scopeId"));
  if (!(await getProject(session.workspaceId, scopeId)))
    throw new Error("Project not found");

  const requested = String(formData.get("docType") ?? "other") as DocType;
  const docType = RUN_INPUT_DOC_TYPES.includes(requested) ? requested : "other";

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Choose a file first");
  if (file.size > 20 * 1024 * 1024) throw new Error("File too large (20 MB max)");

  const extractedText = await extractTextFromFile(file);
  const storagePath = `${session.workspaceId}/project/${scopeId}/${randomUUID()}-${storageSafeName(file.name)}`;
  const { error: uploadError } = await db()
    .storage.from("documents")
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
    });
  if (uploadError) throw uploadError;

  const id = randomUUID();
  const { error } = await db().from("documents").insert({
    id,
    scope_type: "project",
    scope_id: scopeId,
    workspace_id: session.workspaceId,
    kind: "file",
    doc_type: docType,
    source: "upload",
    filename: file.name,
    storage_path: storagePath,
    extracted_text: extractedText,
    created_by: session.userId,
  });
  if (error) throw error;
  await revalidateScope(session.workspaceId, "project", scopeId);
  return { docId: id };
}

/** Markdown/plain-text docs are editable; binary uploads (PDF, DOCX) are not. */
function isMarkdownEditable(doc: {
  storage_path: string | null;
  filename: string | null;
}): boolean {
  if (!doc.storage_path) return true; // pasted or app-created note
  const name = (doc.filename ?? "").toLowerCase();
  return (
    name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")
  );
}

/** Rename a document's display name. The storage object key is left untouched
 *  (it's a UUID-prefixed key, decoupled from the user-facing filename). */
export async function renameDocumentAction(docId: string, filename: string) {
  const session = await requireSession();
  const doc = await getDocument(session.workspaceId, docId);
  if (!doc) throw new Error("Document not found");
  const trimmed = filename.trim();
  if (!trimmed) throw new Error("Name is required");
  const { error } = await db()
    .from("documents")
    .update({ filename: trimmed })
    .eq("id", docId);
  if (error) throw error;
  await revalidateScope(session.workspaceId, doc.scope_type, doc.scope_id);
}

export async function updateDocumentTextAction(docId: string, text: string) {
  const session = await requireSession();
  const doc = await getDocument(session.workspaceId, docId);
  if (!doc) throw new Error("Document not found");
  if (!isMarkdownEditable(doc))
    throw new Error("Only markdown files can be edited");
  const { error } = await db()
    .from("documents")
    .update({ extracted_text: text })
    .eq("id", docId);
  if (error) throw error;
  await revalidateScope(session.workspaceId, doc.scope_type, doc.scope_id);
}

/** Creates an empty markdown note in a client or workspace KB and returns its
 *  id so the UI can open it in edit mode straight away. */
export async function createKbNoteAction(
  scopeType: DocScope,
  scopeId: string,
): Promise<{ docId: string }> {
  const session = await requireSession();
  await assertScope(session, scopeType, scopeId);
  const id = randomUUID();
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const { error } = await db().from("documents").insert({
    id,
    scope_type: scopeType,
    scope_id: scopeId,
    workspace_id: session.workspaceId,
    kind: "kb",
    doc_type: "note",
    source: "pasted",
    filename: `Notes – ${date}.md`,
    extracted_text: "",
    created_by: session.userId,
  });
  if (error) throw error;
  await revalidateScope(session.workspaceId, scopeType, scopeId);
  return { docId: id };
}

/** Returns a short-lived signed URL to download a document's ORIGINAL uploaded
 *  file (the stored object, not the extracted text). Notes that were pasted or
 *  created in-app have no original file. */
export async function getDocumentDownloadUrlAction(
  docId: string,
): Promise<{ url: string }> {
  const session = await requireSession();
  const doc = await getDocument(session.workspaceId, docId);
  if (!doc) throw new Error("Document not found");
  if (!doc.storage_path)
    throw new Error("This note has no original file to download.");
  const { data, error } = await db()
    .storage.from("documents")
    .createSignedUrl(doc.storage_path, 60, {
      // Force a download with the original, human-readable filename rather than
      // the sanitised storage key.
      download: doc.filename ?? true,
    });
  if (error || !data) {
    console.error("getDocumentDownloadUrl: signing failed", error);
    throw new Error("Couldn't prepare the download. Please try again.");
  }
  return { url: data.signedUrl };
}

/** Archive a document instead of hard-deleting it. Run-history tables keep
 * output_doc_id links to documents, so deleting rows can break historical run
 * pages or fail on foreign-key constraints. Archiving hides the document from
 * active document pickers while preserving provenance and downloads. */
export async function archiveDocumentAction(docId: string) {
  const session = await requireSession();
  const doc = await getDocument(session.workspaceId, docId);
  if (!doc) throw new Error("Document not found");
  const { error } = await db()
    .from("documents")
    .update({ is_active: false })
    .eq("id", docId);
  if (error) throw error;
  await revalidateScope(session.workspaceId, doc.scope_type, doc.scope_id);
}

export async function deleteDocumentAction(docId: string) {
  await archiveDocumentAction(docId);
}

export async function setDocumentActiveAction(docId: string, active: boolean) {
  const session = await requireSession();
  const doc = await getDocument(session.workspaceId, docId);
  if (!doc) throw new Error("Document not found");
  if (active && doc.scope_type === "project" && doc.doc_type === "jd") {
    await archivePreviousJd(doc.scope_id);
  }
  const { error } = await db()
    .from("documents")
    .update({ is_active: active })
    .eq("id", docId);
  if (error) throw error;
  await revalidateScope(session.workspaceId, doc.scope_type, doc.scope_id);
}

/** Read a document's extracted text (used by the demo to show an agent's saved
 *  report once the run finishes). Scoped to the caller's workspace. */
export async function getDocumentTextAction(docId: string): Promise<string> {
  const session = await requireSession();
  const doc = await getDocument(session.workspaceId, docId);
  return doc?.extracted_text ?? "";
}
