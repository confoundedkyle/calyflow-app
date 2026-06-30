"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  setSourcingTargetsAction,
  setCandidateFeedbackAction,
  setConnectorBudgetAction,
} from "@/lib/actions/shortlist";
import type { Candidate, CandidateFeedback, ShortlistRun } from "@/lib/types";
import { Button, inputClass } from "./ui";

/** One metered connector's spend row: cap (stored or default) + spend so far. */
export interface ConnectorBudgetRowData {
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
}

const TOOL_LABELS: Record<string, string> = {
  calyflow_search_documents: "Searched knowledge base",
  calyflow_read_document: "Read document",
  calyflow_save_candidate: "Saved a candidate",
  calyflow_list_candidates: "Reviewed saved candidates",
  calyflow_log_sourcing_progress: "Logged progress",
  web_search: "Searched the web",
  web_scrape: "Read a web page",
};

function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const [prefix, ...rest] = tool.split("_");
  return rest.length ? `${prefix} · ${rest.join(" ")}` : tool;
}

function scoreClass(score: number | null): string {
  if (score == null) return "bg-navy-800/8 text-navy-800/50";
  if (score >= 70) return "bg-mint-400/18 text-mint-700";
  if (score >= 40) return "bg-amber-400/18 text-amber-500";
  return "bg-coral-400/14 text-coral-400";
}

export function ShortlistPanel({
  projectId,
  archived,
  candidates,
  qualifiedCount,
  goalQualified,
  budgetUsd,
  spentUsd,
  connectorBudgets,
  hasPlan,
  hasCriteria,
  sourcingPlanHref,
  qualificationHref,
  initialRun,
}: {
  projectId: string;
  archived: boolean;
  candidates: Candidate[];
  qualifiedCount: number;
  goalQualified: number | null;
  budgetUsd: number | null;
  spentUsd: number;
  connectorBudgets: ConnectorBudgetRowData[];
  hasPlan: boolean;
  hasCriteria: boolean;
  sourcingPlanHref: string;
  qualificationHref: string;
  initialRun: ShortlistRun | null;
}) {
  const router = useRouter();
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [goal, setGoal] = useState(goalQualified != null ? String(goalQualified) : "");
  const [budget, setBudget] = useState(budgetUsd != null ? String(budgetUsd) : "");
  const [savePending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

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
        }
      : null,
  );
  const [starting, setStarting] = useState(false);
  const running = run?.status === "running";

  // Poll the latest run while one is in progress; on completion, pull fresh
  // candidates + spend from the server. setState happens inside the async
  // interval callback (not synchronously in the effect body).
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

  // Persist the current goal + budget. Used by both the on-blur auto-save and by
  // Start sourcing (which saves before it runs, so the run uses these values).
  async function persistTargets() {
    const g = goal.trim() ? Number(goal) : null;
    const b = budget.trim() ? Number(budget) : null;
    await setSourcingTargetsAction(projectId, g, b);
  }

  // Auto-save when an input loses focus, so numbers are never lost even if the
  // user never starts a run.
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

  async function startSourcing() {
    if (running || starting || archived) return;
    setError(null);
    setStarting(true);
    try {
      // Save the entered targets first so the run picks them up.
      await persistTargets();
      const res = await fetch("/api/shortlist/run", {
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
        candidates_added: null,
        qualified_after: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sourcing");
    } finally {
      setStarting(false);
    }
  }

  const hasCandidates = candidates.length > 0;
  // Reflect what's typed right now (falls back to the saved value), so the bars
  // and counts update live as the user edits — even before the save lands.
  const goalNum = goal.trim() ? Number(goal) : goalQualified;
  const budgetNum = budget.trim() ? Number(budget) : budgetUsd;
  const goalPct = goalNum ? Math.min(100, (qualifiedCount / goalNum) * 100) : 0;
  const budgetPct = budgetNum ? Math.min(100, (spentUsd / budgetNum) * 100) : 0;
  const startLabel =
    hasCandidates || qualifiedCount > 0 ? "Continue sourcing" : "Start sourcing";

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Shortlist</h2>
        <p className="mt-0.5 text-sm text-navy-800/55">
          Push the button and the sourcing agent works your{" "}
          <Link href={sourcingPlanHref} className="font-medium text-mint-700 hover:underline">
            Sourcing Plan
          </Link>
          , scoring each candidate 0–100 against your{" "}
          <Link href={qualificationHref} className="font-medium text-mint-700 hover:underline">
            Qualification criteria
          </Link>
          . It runs in the background, logs progress, and picks up where it left
          off — until it hits your goal or budget.
        </p>
      </div>

      {(!hasPlan || !hasCriteria) && (
        <div className="mb-4 rounded-card border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-navy-800/80">
          For the best results, set up{" "}
          {!hasPlan && (
            <Link href={sourcingPlanHref} className="font-semibold text-mint-700 hover:underline">
              a Sourcing Plan
            </Link>
          )}
          {!hasPlan && !hasCriteria && " and "}
          {!hasCriteria && (
            <Link href={qualificationHref} className="font-semibold text-mint-700 hover:underline">
              Qualification criteria
            </Link>
          )}{" "}
          first. The agent can still run without them, but it sources and scores
          best with both.
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          {error}
        </p>
      )}

      {/* Controls: goal + budget + run */}
      <div className="rounded-panel border border-navy-800/12 bg-white p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-800/70">
              Goal — qualified candidates
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
              placeholder="e.g. 10"
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
              placeholder="e.g. 25.00"
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
                {connectorBudgets.length > 0
                  ? " (data-source credits below)"
                  : ""}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-navy-800/8 pt-4">
          {/* Targets auto-save (on blur and when you start), so there's just one
              primary action — no separate save step. */}
          <span className="text-xs text-navy-800/45" aria-live="polite">
            {savePending
              ? "Saving…"
              : savedTick
                ? "✓ Saved"
                : "Goal & budget save automatically"}
          </span>
          <div className="flex items-center gap-3">
            {running && (
              <span className="flex items-center gap-2 text-sm text-navy-800/55">
                <span
                  role="status"
                  aria-live="polite"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400"
                />
                Sourcing… you can leave this page
              </span>
            )}
            <Button onClick={startSourcing} disabled={running || starting || archived}>
              {starting ? "Saving & starting…" : running ? "Running…" : `▸ ${startLabel}`}
            </Button>
          </div>
        </div>
      </div>

      {/* Data-source spend limits — only for connected, metered connectors.
          Collapsed by default so simple setups keep the clean two-field view. */}
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
                {connectorBudgets.length > 3
                  ? ` · +${connectorBudgets.length - 3} more`
                  : ""}
              </span>
            )}
          </button>
          {budgetsOpen && (
            <div className="border-t border-navy-800/8 px-5 py-4">
              <p className="mb-4 text-xs text-navy-800/50">
                Cap how much each paid connector may spend on this project, in its
                own units. Spend is tracked per run; the agent skips a connector
                once its cap is reached.
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

      {/* Live trace while a run is in progress */}
      {running && (
        <div className="mt-4 rounded-card border border-navy-800/12 bg-cream-100/60 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-800/40">
            What the agent is doing
          </p>
          <ol className="space-y-1.5">
            {(run?.steps ?? []).map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-0.5 shrink-0">
                  {step.type === "reasoning"
                    ? "💭"
                    : step.type === "tool-call"
                      ? "▸"
                      : "✓"}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      step.type === "reasoning"
                        ? "font-medium italic text-navy-800/55"
                        : "font-medium text-navy-800/80"
                    }
                  >
                    {step.type === "reasoning"
                      ? "Thinking"
                      : toolLabel(step.tool)}
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
              Sourcing…
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
        <div className="mt-4 flex items-start gap-2">
          <span aria-hidden className="mt-0.5 shrink-0 text-mint-700">
            ✓
          </span>
          <div className="prose-calyflow min-w-0 flex-1 text-sm text-navy-800/70">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {run.output_text}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Candidate list */}
      <div className="mt-6">
        <div className="flex items-center justify-between border-b border-navy-800/10 pb-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
            Candidates
          </h3>
          <span className="text-xs text-navy-800/45">
            {candidates.length} total · {qualifiedCount} qualified
          </span>
        </div>

        {!hasCandidates ? (
          <div className="mt-4 rounded-card border border-dashed border-navy-800/15 px-6 py-12 text-center">
            <p className="text-sm text-navy-800/55">
              No candidates yet. Set a goal and start sourcing — they’ll show up
              here, scored and ranked, as the agent works.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-card border border-navy-800/12">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-800/10 bg-cream-100/60 text-left text-xs uppercase tracking-wider text-navy-800/45">
                  <th className="px-4 py-2.5 font-semibold">Candidate</th>
                  <th className="px-3 py-2.5 font-semibold">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Score</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Fit</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <CandidateRow key={c.id} candidate={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
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

  // Reflect what's typed (falls back to the loaded cap) so the bar moves live.
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
        {row.name}{" "}
        <span className="font-normal text-navy-800/40">— {row.unit}</span>
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
              {row.spent} spent
              {capNum ? ` of ${capNum}` : ""} {row.unit}
              {pending ? " · saving…" : tick ? " · ✓ saved" : ""}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function CandidateRow({ candidate: c }: { candidate: Candidate }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<CandidateFeedback | null>(c.feedback);
  const [reason, setReason] = useState(c.feedback_reason ?? "");
  const [, startFeedback] = useTransition();
  const rawEntries = Object.entries(c.raw ?? {});

  // Set / toggle the recruiter verdict. Clicking the active one clears it.
  // Rejecting opens the row so the recruiter can add a reason.
  function setVerdict(next: CandidateFeedback) {
    const value = feedback === next ? null : next;
    setFeedback(value);
    if (value === "rejected") setOpen(true);
    startFeedback(async () => {
      try {
        await setCandidateFeedbackAction(
          c.id,
          value,
          value === "rejected" ? reason : null,
        );
        router.refresh();
      } catch {
        /* leave the optimistic state; a refresh would reconcile */
      }
    });
  }
  function saveReason() {
    if (feedback !== "rejected") return;
    startFeedback(async () => {
      try {
        await setCandidateFeedbackAction(c.id, "rejected", reason);
      } catch {
        /* noop */
      }
    });
  }

  const fitBtn = (active: boolean, tone: "accept" | "reject") =>
    [
      "flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold transition",
      active && tone === "accept" && "border-mint-400 bg-mint-400 text-navy-800",
      active && tone === "reject" && "border-coral-400 bg-coral-400 text-white",
      !active &&
        "border-navy-800/15 text-navy-800/35 hover:border-navy-800/40 hover:text-navy-800/70",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <>
      <tr
        className="cursor-pointer border-b border-navy-800/8 last:border-0 hover:bg-cream-100/40"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-xs text-navy-800/35">
              {open ? "▾" : "▸"}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-navy-900">
                {c.name ?? "Unnamed"}
                {c.qualified && (
                  <span className="ml-2 rounded-chip bg-mint-400/18 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mint-700">
                    Qualified
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-navy-800/45">
                {c.email ?? c.linkedin ?? "—"}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-navy-800/60">{c.source ?? "—"}</td>
        <td className="px-3 py-2.5">
          <span
            className={`inline-block rounded-chip px-2 py-0.5 text-xs font-semibold ${scoreClass(
              c.score,
            )}`}
          >
            {c.score ?? "—"}
          </span>
        </td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              aria-label="Good fit (accept)"
              aria-pressed={feedback === "accepted"}
              title="Good fit — find more like this"
              onClick={() => setVerdict("accepted")}
              className={fitBtn(feedback === "accepted", "accept")}
            >
              ✓
            </button>
            <button
              type="button"
              aria-label="Not a fit (reject)"
              aria-pressed={feedback === "rejected"}
              title="Not a fit — avoid this in future runs"
              onClick={() => setVerdict("rejected")}
              className={fitBtn(feedback === "rejected", "reject")}
            >
              ✕
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-navy-800/8 bg-cream-100/30">
          <td colSpan={4} className="px-4 py-3">
            {feedback === "rejected" && (
              <div className="mb-3" onClick={(e) => e.stopPropagation()}>
                <label className="mb-1 block text-xs font-medium text-navy-800/55">
                  Why isn’t this a fit?{" "}
                  <span className="font-normal text-navy-800/35">
                    optional — the sourcing agent uses it to avoid similar
                    profiles next run
                  </span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={saveReason}
                  rows={2}
                  placeholder="e.g. Too junior; no payments experience; wrong location."
                  className="block w-full resize-y rounded-card border border-navy-800/15 bg-white px-3 py-2 text-xs leading-relaxed outline-none focus:border-coral-400/70 placeholder:text-navy-800/30"
                />
              </div>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
              {c.linkedin && (
                <a
                  href={c.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-mint-700 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  LinkedIn ↗
                </a>
              )}
              {rawEntries.length === 0 ? (
                <span className="text-navy-800/40">No extra fields.</span>
              ) : (
                rawEntries.map(([k, v]) => (
                  <span key={k} className="text-navy-800/60">
                    <span className="font-semibold text-navy-800/45">{k}:</span>{" "}
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                ))
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
