"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { connectorLabel } from "@/lib/connectors";
import {
  updateOutreachDraftAction,
  sendOutreachDraftAction,
  rejectOutreachDraftAction,
  unrejectOutreachDraftAction,
  sendAllOutreachAction,
} from "@/lib/actions/outreach";
import type { OutreachDraft, OutreachRun } from "@/lib/types";
import { Button, inputClass } from "./ui";

interface RunState {
  id: string;
  status: "running" | "succeeded" | "failed";
  steps: { type: string; tool: string; summary: string }[] | null;
  output_text: string | null;
  error_message: string | null;
  drafts_created: number | null;
}

const TOOL_LABELS: Record<string, string> = {
  calyflow_search_documents: "Searched knowledge base",
  calyflow_read_document: "Read document",
  calyflow_save_outreach_draft: "Drafted an email",
  web_search: "Searched the web",
  web_scrape: "Read a web page",
};

function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const [prefix, ...rest] = tool.split("_");
  return rest.length ? `${prefix} · ${rest.join(" ")}` : tool;
}

export function OutreachPanel({
  projectId,
  archived,
  drafts,
  eligibleCount,
  mailboxes,
  senderConfigured,
  connectorsHref,
  personalHref,
  shortlistHref,
  initialRun,
}: {
  projectId: string;
  archived: boolean;
  drafts: OutreachDraft[];
  eligibleCount: number;
  mailboxes: string[];
  senderConfigured: boolean;
  connectorsHref: string;
  personalHref: string;
  shortlistHref: string;
  initialRun: OutreachRun | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState(mailboxes[0] ?? "");
  const [starting, setStarting] = useState(false);
  const [bulkPending, startBulk] = useTransition();

  const [run, setRun] = useState<RunState | null>(
    initialRun
      ? {
          id: initialRun.id,
          status: initialRun.status,
          steps: initialRun.steps as RunState["steps"],
          output_text: initialRun.output_text,
          error_message: initialRun.error_message,
          drafts_created: initialRun.drafts_created,
        }
      : null,
  );
  const running = run?.status === "running";
  const hasMailbox = mailboxes.length > 0;

  const completedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!running) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/outreach/draft?projectId=${projectId}`);
        if (!res.ok || !active) return;
        const { run: latest } = await res.json();
        if (!latest || !active) return;
        setRun(latest as RunState);
        if (latest.status !== "running" && completedRef.current !== latest.id) {
          completedRef.current = latest.id;
          router.refresh();
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const interval = setInterval(tick, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [running, projectId, router]);

  async function startDrafting() {
    if (running || starting || archived) return;
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Could not start (${res.status})`);
      setRun({
        id: body.runId,
        status: "running",
        steps: [],
        output_text: null,
        error_message: null,
        drafts_created: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start drafting");
    } finally {
      setStarting(false);
    }
  }

  const pending = drafts.filter((d) => d.status === "draft");
  const sent = drafts.filter((d) => d.status === "sent");
  const rejected = drafts.filter((d) => d.status === "rejected");
  const failed = drafts.filter((d) => d.status === "failed");

  function sendAll() {
    if (pending.length === 0 || !hasMailbox) return;
    startBulk(async () => {
      setError(null);
      const r = await sendAllOutreachAction(projectId, mailbox || undefined);
      if (r.error) setError(r.error);
      router.refresh();
    });
  }

  const startLabel = drafts.length > 0 ? "Re-draft outreach" : "Draft outreach";

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Outreach</h2>
        <p className="mt-0.5 text-sm text-navy-800/55">
          Draft personalized emails to the candidates you accepted in the{" "}
          <Link href={shortlistHref} className="font-medium text-mint-700 hover:underline">
            Shortlist
          </Link>
          , grounded in the role and your knowledge base. Review and edit each
          one, then approve to send from your own mailbox — nothing goes out
          until you approve it.
        </p>
      </div>

      {!senderConfigured && (
        <div className="mb-4 rounded-card border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-navy-800/80">
          Your sender details aren’t set, so drafts won’t be signed (and may use
          placeholders). Add your name and email signature in{" "}
          <Link href={personalHref} className="font-semibold text-mint-700 hover:underline">
            Settings → Personal
          </Link>{" "}
          before drafting, so every email is signed as you.
        </div>
      )}

      {!hasMailbox && (
        <div className="mb-4 rounded-card border border-coral-400/40 bg-coral-400/8 px-4 py-3 text-sm text-coral-400">
          No mailbox connected. Connect{" "}
          <Link href={connectorsHref} className="font-semibold text-mint-700 hover:underline">
            Gmail or Microsoft Outlook
          </Link>{" "}
          in Settings → Connectors to send outreach. You can still draft emails
          now and send once a mailbox is connected.
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          {error}
        </p>
      )}

      {/* Controls */}
      <div className="rounded-panel border border-navy-800/12 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-navy-800/60">
            {eligibleCount > 0 ? (
              <>
                Drafting for <span className="font-semibold">{eligibleCount}</span>{" "}
                accepted candidate{eligibleCount === 1 ? "" : "s"} with an email.
              </>
            ) : (
              <>
                No eligible candidates yet — accept some in the{" "}
                <Link href={shortlistHref} className="font-medium text-mint-700 hover:underline">
                  Shortlist
                </Link>{" "}
                (Fit ✓) that have an email address.
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {mailboxes.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-navy-800/60">
                Send from
                <select
                  value={mailbox}
                  onChange={(e) => setMailbox(e.target.value)}
                  className="rounded-chip border border-navy-800/15 bg-white px-2 py-1 text-sm"
                >
                  {mailboxes.map((m) => (
                    <option key={m} value={m}>
                      {connectorLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {running && (
              <span className="flex items-center gap-2 text-sm text-navy-800/55">
                <span
                  role="status"
                  aria-live="polite"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400"
                />
                Drafting… you can leave this page
              </span>
            )}
            <Button
              onClick={startDrafting}
              disabled={running || starting || archived || eligibleCount === 0}
            >
              {starting ? "Starting…" : running ? "Running…" : `✉ ${startLabel}`}
            </Button>
          </div>
        </div>
      </div>

      {/* Live trace while drafting */}
      {running && (
        <div className="mt-4 rounded-card border border-navy-800/12 bg-cream-100/60 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-800/40">
            What the agent is doing
          </p>
          <ol className="space-y-1.5">
            {(run?.steps ?? []).map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-0.5 shrink-0">
                  {step.type === "tool-call" ? "▸" : "✓"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-navy-800/80">
                    {toolLabel(step.tool)}
                  </span>
                  <span
                    className="block truncate text-xs text-navy-800/45"
                    title={step.summary}
                  >
                    {step.summary}
                  </span>
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-sm text-navy-800/45">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-mint-400" />
              Drafting…
            </li>
          </ol>
        </div>
      )}

      {!running && run?.status === "failed" && run.error_message && (
        <p className="mt-4 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          Last run failed: {run.error_message}
        </p>
      )}
      {!running && run?.status === "succeeded" && run.output_text && (
        <p className="mt-4 flex items-start gap-2 text-sm text-navy-800/60">
          <span aria-hidden className="mt-0.5 shrink-0 text-mint-700">✓</span>
          <span>{run.output_text}</span>
        </p>
      )}

      {/* Drafts list */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-800/10 pb-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
            Email drafts
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-navy-800/45">
              {pending.length} to review · {sent.length} sent
              {rejected.length ? ` · ${rejected.length} rejected` : ""}
              {failed.length ? ` · ${failed.length} failed` : ""}
            </span>
            {pending.length > 0 && (
              <Button
                variant="small"
                onClick={sendAll}
                disabled={bulkPending || !hasMailbox || archived}
              >
                {bulkPending ? "Sending…" : `Send all (${pending.length})`}
              </Button>
            )}
          </div>
        </div>

        {drafts.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-navy-800/15 px-6 py-12 text-center">
            <p className="text-sm text-navy-800/55">
              No drafts yet. Click <span className="font-medium">Draft outreach</span>{" "}
              to write a personalized email for each accepted candidate.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                mailbox={mailbox}
                hasMailbox={hasMailbox}
                archived={archived}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function statusBadge(status: OutreachDraft["status"]) {
  switch (status) {
    case "sent":
      return "bg-mint-400/18 text-mint-700";
    case "rejected":
      return "bg-navy-800/8 text-navy-800/45";
    case "failed":
      return "bg-coral-400/14 text-coral-400";
    default:
      return "bg-sky-400/15 text-sky-700";
  }
}

function DraftCard({
  draft,
  mailbox,
  hasMailbox,
  archived,
}: {
  draft: OutreachDraft;
  mailbox: string;
  hasMailbox: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [status, setStatus] = useState(draft.status);
  const [edited, setEdited] = useState(draft.edited);
  const [error, setError] = useState<string | null>(draft.error);
  const [, startAction] = useTransition();

  const readOnly = status === "sent";

  function saveEdits() {
    if (subject === (draft.subject ?? "") && body === (draft.body ?? "")) return;
    startAction(async () => {
      try {
        await updateOutreachDraftAction(draft.id, subject, body);
        setEdited(true);
      } catch {
        /* noop — refresh would reconcile */
      }
    });
  }

  function approveSend() {
    setError(null);
    startAction(async () => {
      const r = await sendOutreachDraftAction(draft.id, mailbox || undefined);
      if (r.ok) {
        setStatus("sent");
        router.refresh();
      } else {
        setStatus("failed");
        setError(r.error ?? "Send failed");
      }
    });
  }

  function reject() {
    setStatus("rejected");
    startAction(async () => {
      try {
        await rejectOutreachDraftAction(draft.id);
        router.refresh();
      } catch {
        /* noop */
      }
    });
  }

  function restore() {
    setStatus("draft");
    startAction(async () => {
      try {
        await unrejectOutreachDraftAction(draft.id);
        router.refresh();
      } catch {
        /* noop */
      }
    });
  }

  return (
    <div
      className={`rounded-card border bg-white p-4 ${
        status === "rejected"
          ? "border-navy-800/10 opacity-70"
          : "border-navy-800/12"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold text-navy-900">
            {draft.to_name ?? "Candidate"}
          </span>
          <span className="ml-2 text-xs text-navy-800/45">{draft.to_email}</span>
        </div>
        <div className="flex items-center gap-2">
          {edited && status !== "sent" && (
            <span className="rounded-chip bg-navy-800/8 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy-800/50">
              Edited
            </span>
          )}
          <span
            className={`rounded-chip px-2 py-0.5 text-xs font-semibold capitalize ${statusBadge(
              status,
            )}`}
          >
            {status === "sent" && draft.sent_at
              ? `✓ Sent`
              : status}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={saveEdits}
          readOnly={readOnly}
          placeholder="Subject"
          className={`${inputClass} font-medium ${readOnly ? "bg-cream-100/50" : ""}`}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={saveEdits}
          readOnly={readOnly}
          rows={7}
          placeholder="Email body"
          className={`block w-full resize-y rounded-card border border-navy-800/15 px-3 py-2 text-sm leading-relaxed outline-none focus:border-mint-700 ${
            readOnly ? "bg-cream-100/50" : "bg-white"
          }`}
        />
      </div>

      {error && status === "failed" && (
        <p className="mt-2 text-xs text-coral-400">Send failed: {error}</p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {status === "sent" ? (
          <span className="text-xs text-navy-800/45">
            Sent{draft.provider ? ` via ${connectorLabel(draft.provider)}` : ""}
          </span>
        ) : status === "rejected" ? (
          <Button variant="smallSecondary" onClick={restore} disabled={archived}>
            Restore
          </Button>
        ) : (
          <>
            <Button variant="smallSecondary" onClick={reject} disabled={archived}>
              ✕ Reject
            </Button>
            <Button
              variant="small"
              onClick={approveSend}
              disabled={archived || !hasMailbox || !subject.trim() || !body.trim()}
              title={!hasMailbox ? "Connect a mailbox first" : undefined}
            >
              {status === "failed" ? "↻ Retry send" : "✓ Approve & send"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
