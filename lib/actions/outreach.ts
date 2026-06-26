"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getProject } from "../queries";
import { resolveEmailProvider, sendEmailVia } from "../outreach/send";
import { canSendDraft } from "../outreach/select";
import type { OutreachDraft } from "../types";

async function loadOwnedDraft(
  workspaceId: string,
  draftId: string,
): Promise<OutreachDraft> {
  const { data } = await db()
    .from("outreach_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  const draft = data as OutreachDraft | null;
  if (!draft || draft.workspace_id !== workspaceId) {
    throw new Error("Draft not found");
  }
  return draft;
}

function revalidateOutreach(clientId: string, projectId: string) {
  revalidatePath(`/clients/${clientId}/projects/${projectId}/outreach`);
}

/** Save edits to a draft's subject/body (marks it edited). */
export async function updateOutreachDraftAction(
  draftId: string,
  subject: string,
  body: string,
): Promise<void> {
  const session = await requireSession();
  const draft = await loadOwnedDraft(session.workspaceId, draftId);
  const project = await getProject(session.workspaceId, draft.project_id);
  const { error } = await db()
    .from("outreach_drafts")
    .update({
      subject: subject.trim() || null,
      body: body.trim() || null,
      edited: true,
    })
    .eq("id", draftId);
  if (error) throw error;
  if (project) revalidateOutreach(project.client_id, draft.project_id);
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

async function sendOne(
  draft: OutreachDraft,
  provider: "gmail" | "microsoft-outlook",
  token: string,
  userId: string,
): Promise<SendResult> {
  if (!draft.subject?.trim() || !draft.body?.trim() || !draft.to_email?.trim()) {
    await db()
      .from("outreach_drafts")
      .update({ status: "failed", error: "Missing subject, body, or recipient." })
      .eq("id", draft.id);
    return { ok: false, error: "Missing subject, body, or recipient." };
  }
  try {
    const { id } = await sendEmailVia(provider, token, {
      to: draft.to_email,
      subject: draft.subject,
      body: draft.body,
    });
    await db()
      .from("outreach_drafts")
      .update({
        status: "sent",
        provider,
        sent_message_id: id || null,
        sent_at: new Date().toISOString(),
        reviewed_by: userId,
        error: null,
      })
      .eq("id", draft.id);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    await db()
      .from("outreach_drafts")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", draft.id);
    return { ok: false, error: message };
  }
}

/** Approve & send one draft from the workspace's mailbox (provider override when
 *  both Gmail and Outlook are connected). */
export async function sendOutreachDraftAction(
  draftId: string,
  provider?: string,
): Promise<SendResult> {
  const session = await requireSession();
  const draft = await loadOwnedDraft(session.workspaceId, draftId);
  const project = await getProject(session.workspaceId, draft.project_id);
  if (!canSendDraft(draft.status, draft.to_email)) {
    return {
      ok: false,
      error: draft.status === "sent" ? "Already sent." : "Nothing to send.",
    };
  }
  let result: SendResult;
  try {
    const { provider: prov, token } = await resolveEmailProvider(
      session.workspaceId,
      provider,
    );
    result = await sendOne(draft, prov, token, session.userId);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
  if (project) revalidateOutreach(project.client_id, draft.project_id);
  return result;
}

/** Reject a draft so it won't be sent (and is excluded from "Send all"). */
export async function rejectOutreachDraftAction(draftId: string): Promise<void> {
  const session = await requireSession();
  const draft = await loadOwnedDraft(session.workspaceId, draftId);
  if (draft.status === "sent") return; // can't unsend
  const project = await getProject(session.workspaceId, draft.project_id);
  await db()
    .from("outreach_drafts")
    .update({ status: "rejected", reviewed_by: session.userId })
    .eq("id", draftId);
  if (project) revalidateOutreach(project.client_id, draft.project_id);
}

/** Restore a rejected draft back to a sendable draft. */
export async function unrejectOutreachDraftAction(
  draftId: string,
): Promise<void> {
  const session = await requireSession();
  const draft = await loadOwnedDraft(session.workspaceId, draftId);
  if (draft.status !== "rejected") return;
  const project = await getProject(session.workspaceId, draft.project_id);
  await db()
    .from("outreach_drafts")
    .update({ status: "draft", reviewed_by: session.userId })
    .eq("id", draftId);
  if (project) revalidateOutreach(project.client_id, draft.project_id);
}

export interface SendAllResult {
  sent: number;
  failed: number;
  error?: string;
}

/** Send every remaining (un-rejected, un-sent) draft for a project. */
export async function sendAllOutreachAction(
  projectId: string,
  provider?: string,
): Promise<SendAllResult> {
  const session = await requireSession();
  const project = await getProject(session.workspaceId, projectId);
  if (!project) throw new Error("Project not found");

  let prov: "gmail" | "microsoft-outlook";
  let token: string;
  try {
    ({ provider: prov, token } = await resolveEmailProvider(
      session.workspaceId,
      provider,
    ));
  } catch (err) {
    return {
      sent: 0,
      failed: 0,
      error: err instanceof Error ? err.message : "No mailbox connected",
    };
  }

  const { data } = await db()
    .from("outreach_drafts")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "draft");
  const drafts = (data ?? []) as OutreachDraft[];

  let sent = 0;
  let failed = 0;
  for (const draft of drafts) {
    const r = await sendOne(draft, prov, token, session.userId);
    if (r.ok) sent++;
    else failed++;
  }
  revalidateOutreach(project.client_id, projectId);
  return { sent, failed };
}
