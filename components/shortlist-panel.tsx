"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setCandidateFeedbackAction } from "@/lib/actions/shortlist";
import { findCandidateEmailAction } from "@/lib/actions/enrichment";
import { formatShortlistAddedAt, formatShortlistDateTime } from "@/lib/shortlist-time";
import type { Candidate, CandidateFeedback } from "@/lib/types";
import { Button } from "./ui";
import {
  ShortlistEnrichDialog,
  type ConnectedEnrichment,
} from "./shortlist-enrich-dialog";
import { useToast } from "./use-toast";

/** Label a profile link by its host — the stored `linkedin` field can hold any
 *  profile URL (GitHub, Stack Overflow, a personal site), so don't always say
 *  "LinkedIn". */
function profileLinkLabel(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("linkedin.com")) return "LinkedIn";
  if (u.includes("github.com")) return "GitHub";
  if (u.includes("stackoverflow.com")) return "Stack Overflow";
  if (u.includes("gitlab.com")) return "GitLab";
  if (u.includes("twitter.com") || u.includes("x.com")) return "X";
  return "Profile";
}

function scoreClass(score: number | null): string {
  if (score == null) return "bg-navy-800/8 text-navy-800/50";
  if (score >= 70) return "bg-mint-400/18 text-mint-700";
  if (score >= 40) return "bg-amber-400/18 text-amber-500";
  return "bg-coral-400/14 text-coral-400";
}

function useMinuteNow(enabled: boolean): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Intentional post-hydration update: relative labels should reflect the
    // viewer's local clock, not the server render time.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return now;
}

/**
 * Shortlist is the review surface: the candidates the Sourcing Agent found,
 * their scores, contact enrichment, and recruiter fit feedback. Running and
 * steering sourcing (goal, budget, strategy chat) lives on the Sourcing tab.
 */
export function ShortlistPanel({
  projectId,
  candidates,
  qualifiedCount,
  connectedEnrichment,
  connectorsHref,
  sourcingHref,
}: {
  projectId: string;
  candidates: Candidate[];
  qualifiedCount: number;
  connectedEnrichment: ConnectedEnrichment[];
  connectorsHref: string;
  sourcingHref: string;
}) {
  const [enrichOpen, setEnrichOpen] = useState(false);
  const hasLiveEnrichment = connectedEnrichment.some((c) => c.live);
  const { toast, showToast } = useToast();
  const hasCandidates = candidates.length > 0;
  const now = useMinuteNow(hasCandidates);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Shortlist</h2>
        <p className="mt-0.5 text-sm text-navy-800/55">
          The candidates your sourcing agent found, scored 0–100 against your
          Qualification criteria. Review, find emails, and rate fit here — run and
          steer sourcing from the{" "}
          <Link href={sourcingHref} className="font-medium text-mint-700 hover:underline">
            Sourcing
          </Link>{" "}
          tab.
        </p>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between gap-3 border-b border-navy-800/10 pb-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
            Candidates
          </h3>
          <div className="flex items-center gap-3">
            {hasCandidates && (
              <Button variant="smallSecondary" onClick={() => setEnrichOpen(true)}>
                ✉ Find emails
              </Button>
            )}
            <span className="text-xs text-navy-800/45">
              {candidates.length} total · {qualifiedCount} qualified
            </span>
          </div>
        </div>

        {!hasCandidates ? (
          <div className="mt-4 rounded-card border border-dashed border-navy-800/15 px-6 py-12 text-center">
            <p className="text-sm text-navy-800/55">
              No candidates yet. Head to the{" "}
              <Link href={sourcingHref} className="font-medium text-mint-700 hover:underline">
                Sourcing
              </Link>{" "}
              tab to plan and run a search — candidates show up here, scored and
              ranked, as the agent works.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-card border border-navy-800/12">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-800/10 bg-cream-100/60 text-left text-xs uppercase tracking-wider text-navy-800/45">
                  <th className="px-4 py-2.5 font-semibold">Candidate</th>
                  <th className="px-3 py-2.5 font-semibold">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Added</th>
                  <th className="px-3 py-2.5 font-semibold">Email</th>
                  <th className="px-3 py-2.5 font-semibold">Score</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Fit</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    now={now}
                    hasLiveEnrichment={hasLiveEnrichment}
                    onNeedEnrichment={() => setEnrichOpen(true)}
                    onToast={showToast}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ShortlistEnrichDialog
        open={enrichOpen}
        onClose={() => setEnrichOpen(false)}
        projectId={projectId}
        candidates={candidates}
        connectedEnrichment={connectedEnrichment}
        connectorsHref={connectorsHref}
      />
      {toast}
    </div>
  );
}

function CandidateRow({
  candidate: c,
  now,
  hasLiveEnrichment,
  onNeedEnrichment,
  onToast,
}: {
  candidate: Candidate;
  now: Date | null;
  hasLiveEnrichment: boolean;
  onNeedEnrichment: () => void;
  onToast: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<CandidateFeedback | null>(c.feedback);
  const [reason, setReason] = useState(c.feedback_reason ?? "");
  const [, startFeedback] = useTransition();
  const [email, setEmail] = useState(c.email);
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const rawEntries = Object.entries(c.raw ?? {});
  const addedAt = new Date(c.created_at);
  const addedAtTitle = Number.isNaN(addedAt.getTime())
    ? undefined
    : formatShortlistDateTime(addedAt);

  // "Find email" for one candidate: use a connected one-click tool if there is
  // one, else open the enrichment dialog (the CSV round-trip / connect prompt).
  async function findEmail() {
    if (finding) return;
    if (!hasLiveEnrichment) {
      onNeedEnrichment();
      return;
    }
    setFinding(true);
    setFindMsg(null);
    try {
      const res = await findCandidateEmailAction(c.id);
      if (res.email) {
        setEmail(res.email);
        onToast(`Found email for ${c.name ?? "candidate"}`);
        router.refresh();
      } else {
        setFindMsg("Not found");
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "NO_ENRICHMENT_TOOL") {
        onNeedEnrichment();
      } else {
        setFindMsg(code || "Lookup failed");
      }
    } finally {
      setFinding(false);
    }
  }

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
        className={[
          "cursor-pointer border-b border-navy-800/8 last:border-0 transition hover:bg-cream-100/40",
          // Rejected candidates fade out; hover restores full strength so the
          // verdict is still easy to review and toggle back.
          feedback === "rejected" ? "opacity-40 hover:opacity-100" : "",
        ].join(" ")}
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
                {email ?? c.linkedin ?? "—"}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-navy-800/60">{c.source ?? "—"}</td>
        <td className="px-3 py-2.5 text-xs font-medium text-navy-800/50" title={addedAtTitle}>
          <span suppressHydrationWarning>
            {now ? formatShortlistAddedAt(c.created_at, now) : addedAtTitle ?? "—"}
          </span>
        </td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          {email ? (
            <a
              href={`mailto:${email}`}
              className="block max-w-[16rem] truncate font-medium text-mint-700 hover:underline"
              title={email}
            >
              {email}
            </a>
          ) : finding ? (
            <span className="flex items-center gap-2 text-xs text-navy-800/50">
              <span
                role="status"
                aria-live="polite"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400"
              />
              Looking…
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={findEmail}
                title={
                  c.linkedin
                    ? "Find this candidate's email"
                    : "Find this candidate's email (set up enrichment)"
                }
                className="inline-flex items-center gap-1.5 rounded-chip border-[1.5px] border-navy-800/20 px-2.5 py-1 text-xs font-semibold text-navy-800/70 transition hover:border-navy-800/50 hover:text-navy-800"
              >
                ✉ Find email
              </button>
              {findMsg && (
                <span className="text-xs text-coral-400">{findMsg}</span>
              )}
            </div>
          )}
        </td>
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
          <td colSpan={6} className="px-4 py-3">
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
                  {profileLinkLabel(c.linkedin)} ↗
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
