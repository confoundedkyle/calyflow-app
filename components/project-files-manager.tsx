"use client";

import { useState } from "react";
import Link from "next/link";
import { setDocumentActiveAction } from "@/lib/actions/documents";
import type { Doc } from "@/lib/types";
import { TYPE_LABELS, UploadForm } from "./add-document";
import { DeleteDocButton } from "./delete-doc-button";
import { LocalDateTime } from "./local-datetime";
import { Chip, Mono } from "./ui";

// Project files are managed as fixed "slots": one active JD / intake / scorecard
// per project, plus any number of "other" docs. Each category shows its own
// file(s) directly beneath its header so it reads as one unit (slot + contents),
// rather than the old split of category rows on top and a flat file list below.
const CATEGORIES: { docType: string; multi: boolean; required: boolean }[] = [
  { docType: "jd", multi: false, required: true },
  { docType: "intake_notes", multi: false, required: true },
  { docType: "scorecard", multi: false, required: true },
  { docType: "other", multi: true, required: false },
];

function DocCategoryRow({ doc }: { doc: Doc }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <Link
          href={`/document/${doc.id}`}
          className={`text-sm font-medium hover:text-mint-700 ${
            doc.is_active ? "" : "text-navy-800/40 line-through"
          }`}
        >
          {doc.filename ?? "Untitled"}
        </Link>
        <Mono className="ml-2">
          <LocalDateTime iso={doc.created_at} />
        </Mono>
      </div>
      {!doc.is_active && <Chip tone="amber">archived</Chip>}
      {doc.doc_type === "jd" && !doc.is_active && (
        <form action={setDocumentActiveAction.bind(null, doc.id, true)}>
          <button className="text-sm font-semibold text-mint-700 hover:underline">
            Make active
          </button>
        </form>
      )}
      <DeleteDocButton docId={doc.id} filename={doc.filename} />
    </li>
  );
}

function DocCategorySection({
  scopeId,
  docType,
  multi,
  required,
  docs,
  isOpen,
  onToggle,
  onDone,
}: {
  scopeId: string;
  docType: string;
  multi: boolean;
  required: boolean;
  docs: Doc[];
  isOpen: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const label = TYPE_LABELS[docType] ?? docType;
  const active = docs.filter((d) => d.is_active);
  const archived = docs.filter((d) => !d.is_active);
  // A doc only counts as ready if it has readable text — agents read the text,
  // not the filename. A file whose text didn't extract (e.g. a scanned or
  // secured PDF) would otherwise show ✓ here yet be invisible to every agent.
  const withText = active.filter((d) => d.extracted_text?.trim());
  const filled = withText.length > 0;
  const textless = active.length > 0 && withText.length === 0;
  const panelId = `add-${docType}`;

  return (
    <div
      className={`flex flex-col rounded-card border bg-white p-4 transition ${
        !filled && required
          ? "border-amber-400/30"
          : "border-navy-800/12"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            filled
              ? "bg-mint-400/30 text-mint-700"
              : "border border-navy-800/20 text-navy-800/30"
          }`}
        >
          {filled ? "✓" : ""}
        </span>
        <span
          className={`flex-1 text-sm font-semibold ${
            filled ? "text-navy-900" : "text-navy-800/55"
          }`}
        >
          {label}
          {multi && active.length > 0 && (
            <span className="ml-1.5 font-normal text-navy-800/45">
              ({active.length})
            </span>
          )}
          <span className="sr-only">{filled ? " — complete" : " — missing"}</span>
          {!filled && required && (
            <span className="ml-2 text-xs font-normal text-amber-400">
              missing
            </span>
          )}
        </span>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className={[
            "shrink-0 rounded-chip px-3 py-1 text-xs font-semibold transition",
            isOpen
              ? // Cancel stays a subtle outline so it doesn't read as the CTA.
                "border border-navy-800/20 text-navy-800/60 hover:border-mint-700 hover:text-mint-700"
              : // Add / Replace use the primary CTA fill so the action is obvious.
                "bg-mint-400 text-navy-800 hover:brightness-105",
          ].join(" ")}
        >
          {isOpen ? "Cancel" : multi || !filled ? "Add" : "Replace"}
        </button>
      </div>

      {active.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-navy-800/8 pt-3">
          {active.map((doc) => (
            <DocCategoryRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="mt-2 text-xs font-semibold text-navy-800/45 transition hover:text-navy-800/70"
          >
            {showArchived ? "Hide" : `${archived.length} previous version${archived.length > 1 ? "s" : ""}`}
          </button>
          {showArchived && (
            <ul className="space-y-1">
              {archived.map((doc) => (
                <DocCategoryRow key={doc.id} doc={doc} />
              ))}
            </ul>
          )}
        </div>
      )}

      {textless && !isOpen && (
        <p className="mt-2 text-xs text-amber-400">
          “{active[0]?.filename}” has no readable text, so agents can’t use it —
          re-add it as text or Markdown (a scanned or secured PDF won’t extract).
        </p>
      )}
      {!filled && !textless && !isOpen && (
        <p className="mt-2 text-xs text-navy-800/40">
          {required
            ? "Required before this can run."
            : "Optional — add files the agents can use."}
        </p>
      )}

      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-label={`Add ${label}`}
          className="mt-3 rounded-lg border border-navy-800/10 bg-cream-50 p-4"
        >
          <UploadForm
            scopeType="project"
            scopeId={scopeId}
            kind="file"
            docType={docType}
            compact
            onDone={onDone}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The project Admin "Project files" manager: one section per document category,
 * each listing its own file(s) and offering Upload / Import from URL / Paste.
 * Replaces the old AddDocument-slots + flat DocList split layout.
 */
export function ProjectFilesManager({
  scopeId,
  docs,
}: {
  scopeId: string;
  docs: Doc[];
}) {
  const [openType, setOpenType] = useState<string | null>(null);

  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      {CATEGORIES.map(({ docType, multi, required }) => (
        <DocCategorySection
          key={docType}
          scopeId={scopeId}
          docType={docType}
          multi={multi}
          required={required}
          docs={docs.filter((d) => (d.doc_type ?? "other") === docType)}
          isOpen={openType === docType}
          onToggle={() => setOpenType(openType === docType ? null : docType)}
          onDone={() => setOpenType(null)}
        />
      ))}
    </div>
  );
}
