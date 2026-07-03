"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { setConnectorBudgetAction } from "@/lib/actions/shortlist";
import {
  setSessionArchivedAction,
  setSessionTargetsAction,
} from "@/lib/actions/sourcing";
import type { AgentChatTurn, ShortlistRun } from "@/lib/types";
import type { ChannelSignals } from "@/lib/sourcing/signals";
import {
  DEFAULT_SESSION_GOAL,
  DEFAULT_SESSION_BUDGET_USD,
} from "@/lib/shortlist/budget";
import { Button, inputClass } from "./ui";
import { GenerateDocDialog } from "./generate-doc-dialog";
import { useToast } from "./use-toast";

interface ConnectorBudgetRowData {
  provider: string;
  name: string;
  unit: string;
  cap: number | null;
  spent: number;
}

interface RunState {
  id: string;
  status: "running" | "succeeded" | "failed";
  steps: { type: string; tool: string; summary: string }[] | null;
  output_text: string | null;
  error_message: string | null;
  candidates_added: number | null;
  qualified_after: number | null;
  outcome: string | null;
  learnings: string | null;
}

const TOOL_LABELS: Record<string, string> = {
  calyflow_search_documents: "Searched knowledge base",
  calyflow_read_document: "Read document",
  calyflow_list_candidates: "Reviewed saved candidates",
  calyflow_save_candidate: "Saved a candidate",
  signalhire_source_people: "Ran SignalHire search ladder",
  signalhire_search_people: "Searched SignalHire",
  contactout_source_people: "Ran ContactOut search ladder",
  contactout_people_search: "Searched ContactOut",
  coresignal_source_employees: "Ran Coresignal search ladder",
  web_search: "Searched the web",
  web_scrape: "Read a web page",
};
function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const [prefix, ...rest] = tool.split("_");
  return rest.length ? `${prefix} · ${rest.join(" ")}` : tool;
}

/** The reasoning stream sometimes glues a bold "section title" onto the end of a
 *  thought (e.g. "…web search.**Evaluating tools**"). Break a trailing bold run
 *  onto its own line so it reads as a heading instead of run-on text. */
function formatThinking(text: string): string {
  return text.replace(/(\S)(\*\*[^*\n]+\*\*)(\s*(?:\n|$))/g, "$1\n\n$2$3");
}

/** One live/streamed strategist turn (a proposal). */
interface ChatTurn {
  id: string;
  task: string | null;
  output: string;
  steps: { type: string; tool: string; summary: string }[];
  running: boolean;
  error: string | null;
}

function outcomeChip(outcome: string | null): { label: string; cls: string } | null {
  if (!outcome) return null;
  if (outcome === "successful")
    return { label: "Successful search", cls: "bg-mint-400/18 text-mint-700" };
  if (outcome === "weak")
    return { label: "Weak search", cls: "bg-amber-400/18 text-amber-500" };
  return { label: "Dry search", cls: "bg-navy-800/8 text-navy-800/50" };
}

export function SourcingPanel({
  projectId,
  archived,
  goalQualified,
  budgetUsd,
  projectBudgetUsd,
  spentUsd,
  qualifiedCount,
  connectorBudgets,
  connectors,
  signals,
  hasPlan,
  hasCriteria,
  shortlistHref,
  documentsHref,
  settingsHref,
  connectorsHref,
  basePath,
  initialConversation,
  sessions,
  initialRun,
}: {
  projectId: string;
  archived: boolean;
  goalQualified: number | null;
  budgetUsd: number | null;
  projectBudgetUsd: number | null;
  spentUsd: number;
  qualifiedCount: number;
  connectorBudgets: ConnectorBudgetRowData[];
  connectors: string[];
  signals: ChannelSignals;
  hasPlan: boolean;
  hasCriteria: boolean;
  shortlistHref: string;
  documentsHref: string;
  settingsHref: string;
  connectorsHref: string;
  basePath: string;
  initialConversation: { conversationId: string; turns: AgentChatTurn[] } | null;
  sessions: {
    conversationId: string;
    title: string;
    createdAt: string;
    archived: boolean;
  }[];
  initialRun: ShortlistRun | null;
}) {
  const router = useRouter();
  const { toast, showToast } = useToast();

  // ---- Targets (goal + budget), auto-saved on blur ----
  const [goal, setGoal] = useState(
    goalQualified != null ? String(goalQualified) : "",
  );
  const [budget, setBudget] = useState(budgetUsd != null ? String(budgetUsd) : "");
  const [savePending, startSave] = useTransition();
  const [savedTick, setSavedTick] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [genOpen, setGenOpen] = useState<null | "plan" | "criteria">(null);
  const [error, setError] = useState<string | null>(null);
  // Sourcing shouldn't start without both prerequisite docs.
  const prereqsReady = hasPlan && hasCriteria;

  // A session needs a conversation id before its goal/budget can be stored — for
  // a brand-new session we mint one lazily (in a handler, never during render, to
  // avoid an SSR/hydration mismatch) and reuse it for the strategist + the run.
  const convIdRef = useRef<string | null>(
    initialConversation?.conversationId ?? null,
  );
  function ensureConversationId(): string {
    if (!convIdRef.current) {
      convIdRef.current = crypto.randomUUID();
      setConversationId(convIdRef.current);
    }
    return convIdRef.current;
  }

  async function persistTargets() {
    const g = goal.trim() ? Number(goal) : null;
    const b = budget.trim() ? Number(budget) : null;
    await setSessionTargetsAction(projectId, ensureConversationId(), g, b);
  }
  function handleBlurSave() {
    startSave(async () => {
      try {
        setError(null);
        await persistTargets();
        setSavedTick(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save targets");
      }
    });
  }

  // Unset goal/budget fall back to the session defaults (5 qualified, $3) both
  // for display and for the run — so a session always has sensible targets.
  const goalNum =
    (goal.trim() ? Number(goal) : goalQualified) ?? DEFAULT_SESSION_GOAL;
  const budgetNum =
    (budget.trim() ? Number(budget) : budgetUsd) ?? DEFAULT_SESSION_BUDGET_USD;
  const goalPct = goalNum ? Math.min(100, (qualifiedCount / goalNum) * 100) : 0;
  const budgetPct = budgetNum ? Math.min(100, (spentUsd / budgetNum) * 100) : 0;

  // ---- Strategist chat ----
  const [turns, setTurns] = useState<ChatTurn[]>(
    (initialConversation?.turns ?? []).map((t) => ({
      id: t.id,
      task: t.task,
      output: t.output_text ?? "",
      steps: (t.steps ?? []) as ChatTurn["steps"],
      running: false,
      // A client-disconnect abort persisted before the stream fix isn't a real
      // failure — drop it so old sessions don't show a stale red error card.
      error:
        t.error_message && /already closed|aborted|cancel/i.test(t.error_message)
          ? null
          : t.error_message,
    })),
  );
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversation?.conversationId ?? null,
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // The latest successful proposal (approvable). Derived: last non-running,
  // non-error turn with output.
  const lastTurn = turns[turns.length - 1];
  // A real proposal has substance — an interrupted stream can persist a stray
  // fragment (e.g. "1"), which must NOT be offered for approval.
  const isProposal = (text: string) => text.trim().length >= 40;
  const pendingProposal =
    lastTurn && !lastTurn.running && !lastTurn.error && isProposal(lastTurn.output)
      ? lastTurn.output
      : null;

  // Turns worth rendering — a stale/aborted strategize run can leave a row with
  // no task, steps, output or error; never draw an empty card for it.
  const visibleTurns = turns.filter(
    (t) =>
      t.task || t.steps.length > 0 || t.output.trim() || t.error || t.running,
  );
  // Whether a real proposal exists yet — drives the composer's primary CTA so
  // "Propose a plan" is always offered until there's something to approve.
  const hasProposal = turns.some((t) => isProposal(t.output));

  // ---- Sourcing run (approve → run), polled ----
  const [run, setRun] = useState<RunState | null>(
    initialRun
      ? {
          id: initialRun.id,
          status: initialRun.status,
          steps: initialRun.steps as RunState["steps"],
          output_text: initialRun.output_text,
          error_message: initialRun.error_message,
          candidates_added: initialRun.candidates_added,
          qualified_after: initialRun.qualified_after,
          outcome: initialRun.outcome,
          learnings: initialRun.learnings,
        }
      : null,
  );
  const running = run?.status === "running";
  const completedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!running) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/shortlist/run?projectId=${projectId}`);
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

  // Send a message to the strategist and stream the proposal back.
  async function sendStrategy(task: string) {
    if (sending || locked) return;
    setError(null);
    setSending(true);
    // Save targets first so the proposal is sized to the current goal/budget.
    try {
      await persistTargets();
    } catch {
      /* non-fatal for proposing */
    }

    const turnId = `live-${turns.length}`;
    setTurns((prev) => [
      ...prev,
      { id: turnId, task: task || null, output: "", steps: [], running: true, error: null },
    ]);

    const cid = ensureConversationId();
    try {
      const res = await fetch("/api/sourcing/strategize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, task, conversationId: cid }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Could not propose (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const update = (fn: (t: ChatTurn) => ChatTurn) =>
        setTurns((prev) => prev.map((t) => (t.id === turnId ? fn(t) : t)));

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "text") {
            update((t) => ({ ...t, output: t.output + String(evt.value ?? "") }));
          } else if (evt.type === "tool-call" || evt.type === "tool-result") {
            update((t) => ({
              ...t,
              steps: [
                ...t.steps,
                {
                  type: String(evt.type),
                  tool: String(evt.tool ?? ""),
                  summary: String(evt.summary ?? ""),
                },
              ],
            }));
          } else if (evt.type === "error") {
            update((t) => ({ ...t, error: String(evt.message ?? "Failed") }));
          } else if (evt.type === "done") {
            const newConv = evt.conversationId ? String(evt.conversationId) : null;
            if (newConv && newConv !== conversationId) {
              convIdRef.current = newConv;
              setConversationId(newConv);
              // Reflect the new session in the URL WITHOUT a router navigation:
              // router.replace() would change the page's key and remount this
              // panel, throwing away the proposal we just streamed (the "reload"
              // effect). history.replaceState updates the address bar only, so a
              // manual refresh still resumes the session.
              window.history.replaceState(
                null,
                "",
                `${basePath}/sourcing?c=${newConv}`,
              );
            }
          }
        }
      }
      update((t) => ({ ...t, running: false }));
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                running: false,
                error: err instanceof Error ? err.message : "Failed to propose",
              }
            : t,
        ),
      );
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const task = input.trim();
    setInput("");
    void sendStrategy(task);
  }

  // Approve the pending proposal → start a sourcing run with it as the guideline.
  const [approving, setApproving] = useState(false);
  // The proposal text that has already been sent to a run, so we don't keep
  // offering "Approve & run" for a plan that already executed. Seeded from this
  // session's latest run so it survives a reload (the run records its strategy).
  const [approvedProposal, setApprovedProposal] = useState<string | null>(
    initialRun &&
      initialRun.conversation_id === (initialConversation?.conversationId ?? null)
      ? initialRun.strategy
      : null,
  );
  // Whether the current proposal has already been run. Compare leniently — the
  // stored strategy is trimmed + capped at 8000 chars, so exact-equality would
  // miss a trailing newline on the streamed proposal.
  const norm = (s: string) => s.trim().slice(0, 8000);
  const alreadyRan =
    approvedProposal != null &&
    pendingProposal != null &&
    norm(pendingProposal) === norm(approvedProposal);
  async function approveAndRun() {
    if (!pendingProposal || running || approving || locked) return;
    if (!prereqsReady) {
      setError(
        "Generate the Sourcing Plan and Qualification criteria before running a search.",
      );
      return;
    }
    setError(null);
    setApproving(true);
    try {
      await persistTargets();
      const res = await fetch("/api/shortlist/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          strategy: pendingProposal,
          conversationId: ensureConversationId(),
        }),
      });
      const body = await res.json().catch(() => null);
      // A run is already active for this project (one at a time) — likely started
      // from another session/tab. Don't hard-error: surface the in-progress run.
      if (res.status === 409) {
        const latest = await fetch(`/api/shortlist/run?projectId=${projectId}`)
          .then((r) => r.json())
          .catch(() => null);
        if (latest?.run) setRun(latest.run as RunState);
        showToast("A search is already running — showing its progress.");
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? `Could not start (${res.status})`);
      setApprovedProposal(pendingProposal);
      setRun({
        id: body.runId,
        status: "running",
        steps: [],
        output_text: null,
        error_message: null,
        candidates_added: null,
        qualified_after: null,
        outcome: null,
        learnings: null,
      });
      showToast("Sourcing started — candidates will appear in Shortlist");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sourcing");
    } finally {
      setApproving(false);
    }
  }

  function startNewSession() {
    setTurns([]);
    convIdRef.current = null;
    setConversationId(null);
    setInput("");
    router.replace(`${basePath}/sourcing`);
  }

  const [, startArchive] = useTransition();
  function toggleArchive(convId: string, archived: boolean) {
    startArchive(async () => {
      try {
        await setSessionArchivedAction(projectId, convId, archived);
        // If we archived the session we're viewing, drop back to a fresh one.
        if (archived && convId === conversationId) {
          startNewSession();
        } else {
          router.refresh();
        }
      } catch {
        /* non-fatal */
      }
    });
  }

  const activeSessions = sessions.filter((s) => !s.archived);
  const archivedSessions = sessions.filter((s) => s.archived);
  // Viewing an archived session → read-only: no new proposals or runs until it's
  // restored. `locked` gates the composer + approve controls below.
  const currentArchived = sessions.some(
    (s) => s.conversationId === conversationId && s.archived,
  );
  const locked = archived || currentArchived;

  const lastRunChip = !running ? outcomeChip(run?.outcome ?? null) : null;

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          {error}
        </p>
      )}

      <div className="flex gap-6">
        {/* Session rail — newest at top, oldest at bottom, + to add one */}
        <aside className="hidden w-52 shrink-0 sm:block">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-navy-800/45">
              Sessions
            </span>
            <button
              type="button"
              onClick={startNewSession}
              disabled={archived}
              title="New sourcing session"
              aria-label="New sourcing session"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-navy-800/15 text-base leading-none text-navy-800/60 transition hover:border-mint-400 hover:text-mint-700 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <ol className="space-y-1">
            {conversationId &&
              !sessions.some((s) => s.conversationId === conversationId) && (
                <li className="rounded-chip border border-mint-400/40 bg-mint-400/8 px-3 py-2 text-xs font-medium text-navy-800/70">
                  Current session
                </li>
              )}
            {activeSessions.length === 0 && !conversationId && (
              <li className="px-3 py-2 text-xs text-navy-800/40">
                No sessions yet — start one with +.
              </li>
            )}
            {activeSessions.map((s) => {
              const active = s.conversationId === conversationId;
              return (
                <li key={s.conversationId} className="group relative">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`${basePath}/sourcing?c=${s.conversationId}`)
                    }
                    className={[
                      "block w-full rounded-chip py-2 pl-3 pr-8 text-left text-xs transition",
                      active
                        ? "bg-mint-400/12 font-medium text-navy-900"
                        : "text-navy-800/60 hover:bg-navy-800/5",
                    ].join(" ")}
                  >
                    <span className="block truncate">{s.title}</span>
                    <span className="text-[11px] text-navy-800/40">
                      {s.createdAt.slice(0, 10)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleArchive(s.conversationId, true)}
                    disabled={archived}
                    title="Archive session"
                    aria-label="Archive session"
                    className="absolute right-1.5 top-1.5 rounded p-1 text-navy-800/30 opacity-0 transition hover:bg-navy-800/8 hover:text-navy-800/70 focus:opacity-100 group-hover:opacity-100"
                  >
                    <ArchiveIcon />
                  </button>
                </li>
              );
            })}
          </ol>

          {archivedSessions.length > 0 && (
            <div className="mt-4">
              <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-navy-800/30">
                Archived
              </span>
              <ol className="mt-1 space-y-0.5">
                {archivedSessions.map((s) => (
                  <li key={s.conversationId} className="group relative">
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`${basePath}/sourcing?c=${s.conversationId}`)
                      }
                      className="block w-full truncate rounded-chip py-1.5 pl-3 pr-8 text-left text-[11px] text-navy-800/40 transition hover:bg-navy-800/5"
                    >
                      {s.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleArchive(s.conversationId, false)}
                      disabled={archived}
                      title="Restore session"
                      aria-label="Restore session"
                      className="absolute right-1.5 top-1 rounded px-1 py-0.5 text-[10px] font-medium text-navy-800/30 opacity-0 transition hover:text-mint-700 group-hover:opacity-100"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>

        {/* Cockpit */}
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Sourcing</h2>
              <p className="mt-0.5 text-sm text-navy-800/55">
                The agent already knows the role from your Sourcing Plan and
                Qualification criteria. Propose a search and steer the strategy
                here — results land in your{" "}
                <Link href={shortlistHref} className="font-medium text-mint-700 hover:underline">
                  Shortlist
                </Link>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={startNewSession}
              disabled={archived}
              className="shrink-0 rounded-chip border border-navy-800/15 px-2.5 py-1.5 text-xs font-medium text-navy-800/70 transition hover:border-mint-400 hover:text-mint-700 disabled:opacity-40 sm:hidden"
            >
              + New
            </button>
          </div>

          {/* Targets: goal + budget — collapsed to a one-line summary, expand to edit */}
          <div className="rounded-panel border border-navy-800/12 bg-white">
            <button
              type="button"
              onClick={() => setTargetsOpen((o) => !o)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              aria-expanded={targetsOpen}
            >
              <span aria-hidden className="text-xs text-navy-800/35">
                {targetsOpen ? "▾" : "▸"}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-navy-800/70">
                  <span className="font-semibold text-navy-900">
                    {qualifiedCount}
                    {goalNum ? `/${goalNum}` : ""}
                  </span>{" "}
                  qualified
                </span>
                <span className="text-navy-800/70">
                  <span className="font-semibold text-navy-900">
                    ${spentUsd.toFixed(2)}
                  </span>
                  {budgetNum ? ` / $${budgetNum.toFixed(2)}` : ""} spent
                </span>
                <span className="hidden min-w-0 truncate text-xs text-navy-800/45 sm:inline">
                  {connectors.length > 0 ? connectors.join(", ") : "web & GitHub"}
                </span>
              </span>
              {/* Slim goal progress preview when collapsed */}
              {!targetsOpen && goalNum ? (
                <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-navy-800/8 sm:block">
                  <span
                    className="block h-full rounded-full bg-mint-400"
                    style={{ width: `${goalPct}%` }}
                  />
                </span>
              ) : null}
              <span className="text-xs font-medium text-mint-700">
                {targetsOpen ? "Done" : "Edit"}
              </span>
            </button>
            {targetsOpen && (
            <div className="border-t border-navy-800/8 p-4">
            <p className="mb-3 text-xs text-navy-800/50">
              Goal &amp; budget apply to <span className="font-medium">this session</span>.{" "}
              {projectBudgetUsd != null
                ? `The project cap is $${projectBudgetUsd.toFixed(2)} — change it in `
                : "Set the project-wide cap in "}
              <Link href={settingsHref} className="font-medium text-mint-700 hover:underline">
                Settings
              </Link>
              .
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-800/70">
              Goal — qualified (this session)
            </label>
            <input
              type="number"
              min={1}
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value);
                setSavedTick(false);
              }}
              onBlur={handleBlurSave}
              disabled={archived}
              placeholder={`default ${DEFAULT_SESSION_GOAL}`}
              className={inputClass}
            />
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-800/8">
                <div
                  className="h-full rounded-full bg-mint-400 transition-all"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-navy-800/50">
                {qualifiedCount} qualified{goalNum ? ` of ${goalNum}` : ""}
              </p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-800/70">
              Budget (USD)
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                setSavedTick(false);
              }}
              onBlur={handleBlurSave}
              disabled={archived}
              placeholder={`default ${DEFAULT_SESSION_BUDGET_USD.toFixed(2)}`}
              className={inputClass}
            />
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-800/8">
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetPct >= 100 ? "bg-coral-400" : "bg-sky-400"
                  }`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-navy-800/50">
                ${spentUsd.toFixed(2)} spent
                {budgetNum ? ` of $${budgetNum.toFixed(2)}` : ""} · AI model usage
              </p>
            </div>
          </div>
        </div>

        {/* Connectors at a glance */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-navy-800/8 pt-4">
          <span className="text-xs font-medium text-navy-800/45">Connected:</span>
          {connectors.length > 0 ? (
            connectors.map((name) => (
              <span
                key={name}
                className="rounded-chip bg-navy-800/6 px-2 py-0.5 text-xs text-navy-800/65"
              >
                {name}
              </span>
            ))
          ) : (
            <span className="text-xs text-navy-800/45">
              none — the agent will use web search &amp; GitHub
            </span>
          )}
          <Link
            href={connectorsHref}
            className="ml-1 text-xs font-medium text-mint-700 hover:underline"
          >
            Manage
          </Link>
          <span className="ml-auto text-xs text-navy-800/45" aria-live="polite">
            {savePending ? "Saving…" : savedTick ? "✓ Saved" : "Goal & budget save automatically"}
          </span>
        </div>
            </div>
            )}
      </div>

      {/* Before you source: the two prerequisite documents. Sourcing can't run
          without both — generate each here (opens a popup). */}
      <div className="mt-4 rounded-panel border border-navy-800/12 bg-white p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
          Before you source
        </h3>
        <p className="mt-0.5 text-xs text-navy-800/50">
          The agent sources from your Sourcing Plan and scores against your
          Qualification criteria — generate both to start.
        </p>
        <div className="mt-3 space-y-2">
          <PrereqRow
            label="Sourcing Plan"
            ready={hasPlan}
            onGenerate={() => setGenOpen("plan")}
          />
          <PrereqRow
            label="Qualification criteria"
            ready={hasCriteria}
            onGenerate={() => setGenOpen("criteria")}
          />
        </div>
      </div>

      <GenerateDocDialog
        open={genOpen === "plan"}
        onClose={() => setGenOpen(null)}
        endpoint="/api/sourcing-plan/generate"
        title="Sourcing Plan"
        what="The Sourcing Plan is the agent's map for this role — where to look (channels, communities, target companies) and the alternative titles and boolean searches to try. Sourcing runs work this plan, so a good one means better, more relevant candidates. It's generated from the job description and saved to your Documents."
        projectId={projectId}
        documentsHref={documentsHref}
        alreadyExists={hasPlan}
      />
      <GenerateDocDialog
        open={genOpen === "criteria"}
        onClose={() => setGenOpen(null)}
        endpoint="/api/qualification/generate"
        title="Qualification criteria"
        what="The Qualification criteria are the testable 0–100 scoring rubric the agent uses to judge each candidate — must-haves, nice-to-haves, and knock-outs. Without it the agent can't tell a strong match from a weak one. It's generated from the job description and saved to your Documents."
        projectId={projectId}
        documentsHref={documentsHref}
        alreadyExists={hasCriteria}
      />

      {/* Per-connector spend caps */}
      {connectorBudgets.length > 0 && (
        <div className="mt-4 rounded-panel border border-navy-800/12 bg-white">
          <button
            type="button"
            onClick={() => setBudgetsOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
            aria-expanded={budgetsOpen}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="text-xs text-navy-800/35">
                {budgetsOpen ? "▾" : "▸"}
              </span>
              <span className="text-sm font-medium text-navy-800/70">
                Data-source spend limits
              </span>
            </span>
            {!budgetsOpen && (
              <span className="truncate text-xs text-navy-800/45">
                {connectorBudgets
                  .slice(0, 3)
                  .map((c) => `${c.name} ${c.cap ?? "—"} ${c.unit}`)
                  .join(" · ")}
              </span>
            )}
          </button>
          {budgetsOpen && (
            <div className="border-t border-navy-800/8 px-5 py-4">
              <p className="mb-4 text-xs text-navy-800/50">
                Cap how much each paid connector may spend on this project, in its
                own units. The agent skips a connector once its cap is reached.
              </p>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {connectorBudgets.map((row) => (
                  <ConnectorBudgetRow
                    key={row.provider}
                    projectId={projectId}
                    archived={archived}
                    row={row}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Channel performance — what worked / didn't (collapsed by default) */}
      {signals.runs.length > 0 && (
        <div className="mt-4 rounded-panel border border-navy-800/12 bg-white">
          <button
            type="button"
            onClick={() => setPerfOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
            aria-expanded={perfOpen}
          >
            <span aria-hidden className="text-xs text-navy-800/35">
              {perfOpen ? "▾" : "▸"}
            </span>
            <span className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
              Channel performance
            </span>
            <span className="text-xs text-navy-800/40">
              · {signals.totals.runs} search{signals.totals.runs === 1 ? "" : "es"} ·{" "}
              {signals.totals.qualified} qualified
            </span>
          </button>
          {perfOpen && (
          <div className="border-t border-navy-800/8 px-4 py-4">
          <p className="mb-3 text-xs text-navy-800/50">
            What each past search cost and yielded — the agent leans into what worked.
          </p>
          <div className="overflow-hidden rounded-card border border-navy-800/12">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-800/10 bg-cream-100/60 text-left text-xs uppercase tracking-wider text-navy-800/45">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                  <th className="px-3 py-2 font-semibold">Added</th>
                  <th className="px-3 py-2 font-semibold">Qualified</th>
                  <th className="px-3 py-2 font-semibold">Cost</th>
                  <th className="px-3 py-2 font-semibold">Channels</th>
                </tr>
              </thead>
              <tbody>
                {signals.runs.slice(0, 8).map((r) => {
                  const chip = outcomeChip(r.outcome);
                  return (
                    <tr key={r.runId} className="border-b border-navy-800/8 last:border-0">
                      <td className="px-3 py-2 text-navy-800/60">
                        {r.createdAt.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        {chip ? (
                          <span className={`rounded-chip px-2 py-0.5 text-xs ${chip.cls}`}>
                            {chip.label}
                          </span>
                        ) : (
                          <span className="text-xs text-navy-800/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-navy-800/70">{r.candidatesAdded}</td>
                      <td className="px-3 py-2 text-navy-800/70">+{r.qualifiedDelta}</td>
                      <td className="px-3 py-2 text-navy-800/70">${r.costUsd.toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs text-navy-800/55">
                        {r.connectors.length > 0
                          ? r.connectors
                              .map((c) =>
                                c.credits > 0 ? `${c.label} (${c.credits})` : c.label,
                              )
                              .join(", ")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
          )}
        </div>
      )}

      {/* Strategist chat */}
      <div className="mt-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
          Plan the next search
        </h3>
        {currentArchived && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-card border border-navy-800/12 bg-cream-100/50 px-4 py-2.5 text-sm text-navy-800/60">
            This session is archived — read-only.
            <button
              type="button"
              onClick={() => toggleArchive(conversationId!, false)}
              className="font-medium text-mint-700 hover:underline"
            >
              Restore to continue
            </button>
          </div>
        )}
        <div className="mt-3 space-y-4">
          {visibleTurns.length === 0 && (
            <div className="rounded-card border border-dashed border-navy-800/15 px-6 py-8 text-center text-sm text-navy-800/55">
              The agent already has the role from your Sourcing Plan and
              Qualification criteria. Just click{" "}
              <span className="font-medium text-navy-800/70">Propose a plan</span>{" "}
              — or steer the strategy first, e.g. “focus on healthtech companies”,
              “try SignalHire first”, “prioritise senior ICs”.
            </div>
          )}
          {visibleTurns.map((t, i) => (
            <div key={t.id} className="rounded-card border border-navy-800/12 bg-white p-4">
              {t.task && (
                <div className="mb-2 rounded-chip bg-mint-400/12 px-3 py-1.5 text-sm text-navy-800/80">
                  {t.task}
                </div>
              )}
              {t.steps.length > 0 && (
                <ol className="mb-2 space-y-1">
                  {t.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-navy-800/50">
                      <span aria-hidden>{s.type === "tool-call" ? "▸" : "✓"}</span>
                      <span className="truncate" title={s.summary}>
                        {toolLabel(s.tool)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {t.running && !t.output && (
                <div className="flex items-center gap-2 text-sm text-navy-800/55">
                  <span
                    role="status"
                    aria-live="polite"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400"
                  />
                  Thinking through the strategy…
                </div>
              )}
              {t.output && (
                <div className="prose-calyflow min-w-0 text-sm text-navy-800/75">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.output}</ReactMarkdown>
                </div>
              )}
              {t.error && (
                <p className="rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
                  {t.error}
                </p>
              )}
              {/* Approve action, attached as a footer of the proposal card so the
                  plan and its action read as one connected unit. */}
              {i === visibleTurns.length - 1 &&
                pendingProposal &&
                !running &&
                (!alreadyRan ? (
                  <div className="-mx-4 -mb-4 mt-3 flex flex-wrap items-center gap-3 rounded-b-card border-t border-mint-400/30 bg-mint-400/6 px-4 py-3">
                    <span className="text-sm text-navy-800/70">
                      Happy with this plan? Approving runs it now (spends against
                      your budget).
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {!prereqsReady && (
                        <span className="text-xs text-amber-500">
                          Generate both docs above first
                        </span>
                      )}
                      <Button
                        onClick={approveAndRun}
                        disabled={approving || locked || !prereqsReady}
                      >
                        {approving ? "Starting…" : "✓ Approve & run"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="-mx-4 -mb-4 mt-3 flex flex-wrap items-center gap-3 rounded-b-card border-t border-navy-800/12 bg-cream-100/50 px-4 py-3 text-sm text-navy-800/70">
                    <span>
                      ✓ This plan ran — see the result below. To source more,
                      start a new session.
                    </span>
                    <Link
                      href={shortlistHref}
                      className="ml-auto font-medium text-mint-700 hover:underline"
                    >
                      Review in Shortlist →
                    </Link>
                  </div>
                ))}
            </div>
          ))}

          {/* Composer — hidden while a search runs (the live trace shows below). */}
          {/* Composer — hidden while a search runs AND once this session's plan
              has run (a session is one plan → one search; keep sourcing = a new
              session). */}
          {!running && !alreadyRan && (
            <form onSubmit={onSubmit} className="rounded-card border border-navy-800/12 bg-white p-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit(e);
                }}
                disabled={sending || locked}
                rows={2}
                placeholder={
                  currentArchived
                    ? "Restore this session to keep planning…"
                    : hasProposal
                      ? "Steer the next search… (e.g. “now try SignalHire”)"
                      : "Steer the strategy (optional) — e.g. “focus on fintech” or “try Apollo”. Or just propose a plan."
                }
                className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-navy-800/35"
              />
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-xs text-navy-800/40">⌘/Ctrl + Enter</span>
                <Button type="submit" disabled={sending || locked}>
                  {sending ? "Proposing…" : hasProposal ? "Send" : "Propose a plan"}
                </Button>
              </div>
            </form>
          )}

          {/* This session's search has run — steer a new one, not this. */}
          {!running && alreadyRan && (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-navy-800/12 bg-white px-4 py-3.5">
              <span className="text-sm text-navy-800/60">
                This search is done. Start a new session to source more — adjust
                the goal, budget, or strategy.
              </span>
              <div className="ml-auto">
                <Button onClick={startNewSession} disabled={archived}>
                  + New sourcing session
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live run trace */}
      {running && (
        <div className="mt-4 rounded-card border border-navy-800/12 bg-cream-100/60 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-800/40">
            Sourcing in progress — you can leave this page
          </p>
          <ol className="space-y-1.5">
            {(run?.steps ?? []).map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-0.5 shrink-0">
                  {step.type === "reasoning" ? "💭" : step.type === "tool-call" ? "▸" : "✓"}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    className={
                      step.type === "reasoning"
                        ? "font-medium italic text-navy-800/55"
                        : "font-medium text-navy-800/80"
                    }
                  >
                    {step.type === "reasoning" ? "Thinking" : toolLabel(step.tool)}
                  </span>
                  {step.type === "reasoning" ? (
                    step.summary && (
                      <div className="mt-0.5 text-xs leading-relaxed text-navy-800/55 [&_code]:rounded [&_code]:bg-navy-800/8 [&_code]:px-1 [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_p:first-child]:mt-0 [&_strong]:font-semibold [&_strong]:text-navy-800/70 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {formatThinking(step.summary)}
                        </ReactMarkdown>
                      </div>
                    )
                  ) : (
                    <span className="block truncate text-xs text-navy-800/45" title={step.summary}>
                      {step.summary}
                    </span>
                  )}
                </div>
              </li>
            ))}
            <li className="flex items-center gap-2 text-sm text-navy-800/45">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-mint-400" />
              Sourcing…
            </li>
          </ol>
        </div>
      )}

      {/* Last run result + self-evaluation */}
      {!running && run && run.status !== "running" && (
        <div className="mt-4 rounded-card border border-navy-800/12 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-navy-800/75">Last run</p>
            {lastRunChip && (
              <span className={`rounded-chip px-2 py-0.5 text-xs ${lastRunChip.cls}`}>
                {lastRunChip.label}
              </span>
            )}
            {run.candidates_added != null && (
              <span className="text-xs text-navy-800/50">
                +{run.candidates_added} added · {run.qualified_after ?? 0} qualified total
              </span>
            )}
            <Link href={shortlistHref} className="ml-auto text-xs font-medium text-mint-700 hover:underline">
              Review in Shortlist →
            </Link>
          </div>
          {run.status === "failed" &&
            run.error_message &&
            (/abort|timed?\s*out|timeout/i.test(run.error_message) ? (
              // A timeout is a graceful deadline stop — partial results are saved.
              <p className="mt-2 text-xs text-navy-800/45">
                Stopped at the time limit — the candidates it found are saved.
              </p>
            ) : (
              <p className="mt-2 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
                {run.error_message}
              </p>
            ))}
          {run.learnings && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-navy-800/40">
                Learnings for next time
              </p>
              <div className="prose-calyflow mt-1 text-sm text-navy-800/70">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.learnings}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
        </div>
      </div>
      {toast}
    </div>
  );
}

function PrereqRow({
  label,
  ready,
  onGenerate,
}: {
  label: string;
  ready: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-navy-800/10 px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className={ready ? "text-mint-700" : "text-navy-800/25"}
        >
          {ready ? "✓" : "○"}
        </span>
        <span className={ready ? "font-medium text-navy-900" : "text-navy-800/70"}>
          {label}
        </span>
        {ready && <span className="text-xs text-navy-800/40">ready</span>}
      </span>
      {ready ? (
        <button
          type="button"
          onClick={onGenerate}
          className="text-xs font-medium text-navy-800/45 transition hover:text-mint-700"
        >
          Regenerate
        </button>
      ) : (
        <Button variant="smallSecondary" onClick={onGenerate}>
          Generate
        </Button>
      )}
    </div>
  );
}

function ArchiveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function ConnectorBudgetRow({
  projectId,
  archived,
  row,
}: {
  projectId: string;
  archived: boolean;
  row: ConnectorBudgetRowData;
}) {
  const router = useRouter();
  const [value, setValue] = useState(row.cap != null ? String(row.cap) : "");
  const [pending, start] = useTransition();
  const [tick, setTick] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const capNum = value.trim() ? Number(value) : row.cap;
  const pct = capNum && capNum > 0 ? Math.min(100, (row.spent / capNum) * 100) : 0;

  function save() {
    start(async () => {
      try {
        setErr(null);
        const v = value.trim() ? Number(value) : null;
        await setConnectorBudgetAction(projectId, row.provider, v);
        setTick(true);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save");
      }
    });
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-navy-800/70">
        {row.name} <span className="font-normal text-navy-800/40">— {row.unit}</span>
      </label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setTick(false);
        }}
        onBlur={save}
        disabled={archived}
        placeholder={`e.g. ${row.cap ?? 50}`}
        className={inputClass}
      />
      <div className="mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-800/8">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 100 ? "bg-coral-400" : "bg-sky-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-navy-800/50" aria-live="polite">
          {err ? (
            <span className="text-coral-400">{err}</span>
          ) : (
            <>
              {row.spent} spent{capNum ? ` of ${capNum}` : ""} {row.unit}
              {pending ? " · saving…" : tick ? " · ✓ saved" : ""}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
