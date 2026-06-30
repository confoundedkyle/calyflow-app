"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Candidate } from "@/lib/types";
import {
  buildEnrichmentCsv,
  canonicalLinkedinUrl,
  type EnrichmentExportRow,
} from "@/lib/enrichment/csv";
import { importEnrichedCsvAction } from "@/lib/actions/enrichment";
import { Button } from "./ui";

export interface ConnectedEnrichment {
  provider: string;
  name: string;
  live: boolean;
}

/** A good-fit candidate is one the recruiter accepted (✓) or the agent
 *  qualified, and never rejected (✕). These are the people worth spending
 *  enrichment credits on. */
export function isGoodFit(c: Candidate): boolean {
  if (c.feedback === "rejected") return false;
  return c.feedback === "accepted" || c.qualified;
}

/**
 * The Shortlist email-enrichment dialog: explains how enrichment works, shows
 * which connected tools can do it, and runs the CSV round-trip — download the
 * good-fit candidates that still need an email (with their LinkedIn URLs), run
 * the file through ContactOut / Hunter / similar, then re-import it to save the
 * emails. Built for non-technical recruiters: two big numbered steps, no jargon.
 */
export function ShortlistEnrichDialog({
  open,
  onClose,
  projectId,
  candidates,
  connectedEnrichment,
  connectorsHref,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  candidates: Candidate[];
  connectedEnrichment: ConnectedEnrichment[];
  connectorsHref: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const goodFit = candidates.filter(isGoodFit);
  const needEmail = goodFit.filter((c) => !c.email);
  const exportable = needEmail.filter((c) => c.linkedin?.trim());
  const missingLinkedin = needEmail.length - exportable.length;
  const hasLive = connectedEnrichment.some((c) => c.live);

  function handleDownload() {
    const rows: EnrichmentExportRow[] = exportable.map((c) => ({
      id: c.id,
      name: c.name,
      // Export the canonical, slash-terminated URL so the enrichment tool pairs
      // it (LinkedIn redirects to this form anyway).
      linkedin: canonicalLinkedinUrl(c.linkedin) ?? c.linkedin,
    }));
    const csv = buildEnrichmentCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `shortlist-emails-to-find-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const res = await importEnrichedCsvAction(projectId, text);
      const parts = [`Saved ${res.updated} email${res.updated === 1 ? "" : "s"}`];
      if (res.enriched > 0)
        parts.push(`${res.enriched} already had one (extra data added)`);
      if (res.unmatched > 0)
        parts.push(`${res.unmatched} didn't match a candidate`);
      setResult(
        `${parts.join(" · ")}${res.usedAi ? " · columns mapped by AI" : ""}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import the file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find candidate emails"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-panel border border-navy-800/12 bg-white shadow-lift"
      >
        <div className="flex items-center justify-between gap-3 border-b border-navy-800/8 px-6 py-4">
          <div className="min-w-0">
            <h3 className="font-semibold">Find candidate emails</h3>
            <p className="text-xs text-navy-800/45">
              Enrich your good-fit candidates with verified email addresses
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-lg leading-none text-navy-800/40 transition hover:bg-cream-100 hover:text-navy-900"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* How it works */}
          <section>
            <p className="text-sm leading-relaxed text-navy-800/70">
              Calyflow doesn’t store personal emails — you bring your own
              enrichment tool (
              <span className="font-medium text-navy-800/80">
                ContactOut, Hunter, Findymail, Prospeo
              </span>{" "}
              and similar). There are two ways to fill in the emails:
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-navy-800/70">
              <li className="flex gap-2">
                <span aria-hidden>⚡</span>
                <span>
                  <span className="font-medium">One click per candidate</span> —
                  if you connect a supported tool, the “Find email” button looks
                  it up instantly from the LinkedIn URL.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden>📄</span>
                <span>
                  <span className="font-medium">Bulk via CSV</span> — export the
                  list below, run it through any enrichment tool, and import the
                  result. Works with whatever tool you already pay for.
                </span>
              </li>
            </ul>
          </section>

          {/* Connected tools */}
          <section className="rounded-card border border-navy-800/10 bg-cream-100/50 px-4 py-3">
            {connectedEnrichment.length > 0 ? (
              <p className="text-sm text-navy-800/70">
                <span className="font-medium">Connected enrichment tools:</span>{" "}
                {connectedEnrichment.map((c, i) => (
                  <span key={c.provider}>
                    {i > 0 && ", "}
                    {c.name}
                    {c.live && (
                      <span
                        title="Supports one-click lookup"
                        className="ml-1 align-middle text-xs text-mint-700"
                      >
                        ⚡
                      </span>
                    )}
                  </span>
                ))}
                .{" "}
                {hasLive
                  ? "The ⚡ tools power the one-click “Find email” button."
                  : "These work with the CSV round-trip below."}
              </p>
            ) : (
              <p className="text-sm text-navy-800/70">
                You haven’t connected an enrichment tool yet. You can still use
                the CSV round-trip below with any tool, or{" "}
                <Link
                  href={connectorsHref}
                  className="font-semibold text-mint-700 hover:underline"
                >
                  connect one
                </Link>{" "}
                (e.g. ContactOut or Prospeo) for one-click lookups.
              </p>
            )}
          </section>

          {/* Step 1 — download */}
          <section>
            <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-navy-800/80">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
                1
              </span>
              Download the list
            </h4>
            <p className="mb-3 text-sm text-navy-800/60">
              {exportable.length > 0 ? (
                <>
                  {exportable.length} good-fit candidate
                  {exportable.length === 1 ? "" : "s"} still need an email. The
                  CSV has their names and LinkedIn URLs, with a blank{" "}
                  <span className="font-mono text-xs">email</span> column for your
                  tool to fill.
                </>
              ) : needEmail.length > 0 ? (
                <>
                  {needEmail.length} good-fit candidate
                  {needEmail.length === 1 ? "" : "s"} need an email, but none has
                  a LinkedIn URL to look up.
                </>
              ) : (
                <>Every good-fit candidate already has an email. Nice work.</>
              )}
              {missingLinkedin > 0 && exportable.length > 0 && (
                <>
                  {" "}
                  ({missingLinkedin} more have no LinkedIn URL and can’t be
                  exported.)
                </>
              )}
            </p>
            <Button
              variant="smallSecondary"
              onClick={handleDownload}
              disabled={exportable.length === 0}
            >
              ⬇ Download CSV ({exportable.length})
            </Button>
          </section>

          {/* Step 2 — import */}
          <section>
            <h4 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-navy-800/80">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
                2
              </span>
              Import the enriched file
            </h4>
            <p className="mb-3 text-sm text-navy-800/60">
              Run the CSV through your enrichment tool, then upload the result —
              in whatever format it exports. An AI agent figures out the columns
              (personal vs work email, phone, and more), so you don’t have to
              reformat anything. We match each row back to the right candidate
              (by the hidden id or the LinkedIn URL), save a personal email when
              there’s one, and keep the rest of the data on the candidate.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button
              variant="smallSecondary"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              {importing ? "Importing…" : "⬆ Import enriched CSV"}
            </Button>
            {result && (
              <p className="mt-3 rounded-chip bg-mint-400/15 px-3 py-2 text-sm text-mint-700">
                ✓ {result}
              </p>
            )}
            {error && (
              <p className="mt-3 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
                {error}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
