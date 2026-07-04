"use client";

import type { ReactNode } from "react";
import { useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  archiveDocumentAction,
  createKbNoteAction,
  getDocumentDownloadUrlAction,
  renameDocumentAction,
  updateDocumentTextAction,
  uploadDocumentAction,
} from "@/lib/actions/documents";
import type { Doc, DocScope } from "@/lib/types";
import { isMarkdownDoc } from "@/lib/readiness";
import { Button } from "./ui";
import { DownloadButtons } from "./download-buttons";
import { Toast } from "./toast";

/** Markdown/plain-text docs are editable; binary uploads (PDF, DOCX) are not. */
function isEditable(doc: Doc): boolean {
  if (!doc.storage_path) return true;
  const name = (doc.filename ?? "").toLowerCase();
  return (
    name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/** Pencil/edit icon — leans to the right, with an underline stroke. */
function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* nib-to-eraser diagonal, tilted right */}
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      {/* underline */}
      <path d="M12.5 21h8.5" />
    </svg>
  );
}

const ACCEPT = ".pdf,.docx,.txt,.md";
const ALLOWED_EXT = ["pdf", "docx", "txt", "md"];
const MAX_BYTES = 20 * 1024 * 1024;
/** Show the big drag & drop placeholder until this many docs exist — by then
 *  the user has discovered the feature, so it gives way to the file list. */
const DROP_HINT_MAX = 7;

/** Shared look for the sidebar toolbar actions (New note / Upload / Import),
 *  so they read as one cohesive IDE-style action group. Also used by the
 *  ImportDomain trigger passed in via `importSlot`. */
export const toolActionClass =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-navy-800/65 transition hover:bg-navy-800/8 hover:text-navy-900 disabled:cursor-default disabled:opacity-40";

export function DocExplorer({
  scopeType,
  scopeId,
  docs,
  mode,
  importSlot,
  allowUpload = true,
  emptyHint,
}: {
  scopeType: DocScope;
  scopeId: string;
  docs: Doc[];
  mode: "kb" | "files";
  /** Optional extra toolbar action (e.g. the domain-import trigger). */
  importSlot?: ReactNode;
  /** Hide upload affordances — for read-from-elsewhere lists (agent outputs). */
  allowUpload?: boolean;
  /** Message shown when there are no documents and uploads are disabled. */
  emptyHint?: string;
}) {
  // A `?doc=<id>` param (e.g. after an import) selects that doc; otherwise the
  // first one. The effect below re-selects when the param changes on navigation.
  const searchParams = useSearchParams();
  const docParam = searchParams.get("doc");
  const [selectedId, setSelectedId] = useState<string | null>(
    docParam ?? docs[0]?.id ?? null,
  );
  // When the ?doc= param changes (e.g. an import navigates to the new doc),
  // select it. React's "adjust state during render" pattern — guarded so it
  // only fires on an actual change, and never clobbers manual clicks.
  const [seenDocParam, setSeenDocParam] = useState(docParam);
  if (docParam !== seenDocParam) {
    setSeenDocParam(docParam);
    if (docParam && docs.some((d) => d.id === docParam)) setSelectedId(docParam);
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Incrementing key re-mounts the Toast so a re-save restarts its timer.
  const [toastKey, setToastKey] = useState(0);
  const [toastMsg, setToastMsg] = useState("Saved");
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set());

  function showToast(message: string) {
    setToastMsg(message);
    setToastKey((k) => k + 1);
  }

  const visibleDocs = docs.filter((d) => d.is_active && !archivedIds.has(d.id));
  // Fall back to the first visible doc if the selected one was archived.
  const selected = visibleDocs.find((d) => d.id === selectedId) ?? visibleDocs[0] ?? null;

  function select(doc: Doc) {
    setSelectedId(doc.id);
    setEditing(false);
    setRenaming(false);
    setError(null);
  }

  function startRename() {
    if (!selected) return;
    setNameDraft(selected.filename ?? "");
    setRenaming(true);
  }

  function saveName() {
    if (!selected) return;
    const next = nameDraft.trim();
    if (!next || next === selected.filename) {
      setRenaming(false);
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        await renameDocumentAction(selected.id, next);
        setRenaming(false);
        showToast("Name updated");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not rename");
      }
    });
  }

  function startEdit() {
    if (!selected) return;
    setDraft(selected.extracted_text ?? "");
    setEditing(true);
  }

  function save() {
    if (!selected) return;
    startTransition(async () => {
      try {
        setError(null);
        await updateDocumentTextAction(selected.id, draft);
        setEditing(false);
        showToast(mode === "kb" ? "Note saved" : "Document saved");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    });
  }

  function newNote() {
    startTransition(async () => {
      try {
        setError(null);
        const { docId } = await createKbNoteAction(scopeType, scopeId);
        setSelectedId(docId);
        setDraft("");
        setEditing(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create note");
      }
    });
  }

  // Upload one or more files (from the toolbar picker or a drag & drop),
  // reusing the single-file server action per file so revalidation refreshes
  // the list. Unsupported types / oversized files are skipped with a notice.
  function handleFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    startTransition(async () => {
      setError(null);
      const unsupported: string[] = [];
      const tooBig: string[] = [];
      const failed: string[] = [];
      let ok = 0;
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!ALLOWED_EXT.includes(ext)) {
          unsupported.push(file.name);
          continue;
        }
        if (file.size > MAX_BYTES) {
          tooBig.push(file.name);
          continue;
        }
        try {
          const fd = new FormData();
          fd.append("scopeType", scopeType);
          fd.append("scopeId", scopeId);
          fd.append("kind", mode === "kb" ? "kb" : "file");
          fd.append("docType", mode === "kb" ? "note" : "other");
          fd.append("file", file);
          await uploadDocumentAction(fd);
          ok += 1;
        } catch {
          failed.push(file.name);
        }
      }
      if (ok > 0) showToast(ok === 1 ? "File uploaded" : `${ok} files uploaded`);

      // Build one plain-language message instead of surfacing raw server errors.
      const problems: string[] = [];
      if (unsupported.length)
        problems.push(
          `${unsupported.join(", ")} — only PDF, DOCX, TXT and MD files are supported`,
        );
      if (tooBig.length)
        problems.push(`${tooBig.join(", ")} — over the 20 MB limit`);
      if (failed.length)
        problems.push(
          `couldn't read ${failed.join(", ")} — it may be corrupted, password-protected, or a scanned image with no text`,
        );
      setError(problems.length ? `Some files weren't added: ${problems.join("; ")}.` : null);
    });
  }

  // Drag & drop onto the sidebar. A depth counter avoids the flicker that a
  // plain dragenter/dragleave pair causes when moving over child elements.
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  function onDragEnter(e: React.DragEvent) {
    if (!allowUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (!allowUpload || !hasFiles(e)) return;
    e.preventDefault(); // required so the drop event fires
  }
  function onDragLeave(e: React.DragEvent) {
    if (!allowUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  }
  function onDrop(e: React.DragEvent) {
    if (!allowUpload || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function downloadOriginal() {
    if (!selected?.storage_path) return;
    startTransition(async () => {
      try {
        setError(null);
        const { url } = await getDocumentDownloadUrlAction(selected.id);
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't download the file",
        );
      }
    });
  }

  function remove(doc: Doc) {
    if (
      !window.confirm(
        `Archive "${doc.filename ?? "Untitled"}"? It will be hidden from active document lists.`,
      )
    )
      return;
    startTransition(async () => {
      try {
        setError(null);
        await archiveDocumentAction(doc.id);
        setArchivedIds((ids) => {
          const next = new Set(ids);
          next.add(doc.id);
          return next;
        });
        if (doc.id === selectedId) {
          setSelectedId(null);
          setEditing(false);
        }
        showToast("Document archived");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not archive");
      }
    });
  }

  return (
    <>
      {toastKey > 0 && <Toast key={toastKey} message={toastMsg} />}
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-3 rounded-card border border-coral-400/30 bg-coral-400/10 px-4 py-2.5 text-sm text-coral-400"
        >
          <span aria-hidden>⚠</span>
          <span className="flex-1 text-center">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-coral-400/60 transition hover:text-coral-400"
          >
            ✕
          </button>
        </div>
      )}
      <div className="grid overflow-hidden rounded-card border border-navy-800/12 bg-white shadow-[0_1px_3px_rgba(19,31,56,0.04)] lg:min-h-[34rem] lg:grid-cols-[clamp(220px,26%,300px)_1fr]">
        {/* Left: IDE-style file sidebar (also a drag & drop upload target) */}
        <aside
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="relative flex flex-col border-b border-navy-800/10 bg-navy-800/[0.025] lg:border-b-0 lg:border-r"
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-1.5 z-20 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-sky-300 bg-sky-300/25 text-center backdrop-blur-[1px]">
              <span aria-hidden className="text-2xl">
                ⬇
              </span>
              <p className="text-sm font-semibold text-navy-800/80">
                Drop files to upload
              </p>
              <p className="text-xs text-navy-800/55">PDF, DOCX, TXT, MD · 20 MB</p>
            </div>
          )}
          {/* Action toolbar: New note · Upload · Import */}
          {(allowUpload || importSlot) && (
            <div className="flex flex-wrap items-center gap-0.5 border-b border-navy-800/8 px-2 py-1.5">
              {mode === "kb" && allowUpload && (
                <button
                  type="button"
                  onClick={newNote}
                  disabled={pending}
                  title="Create a new note"
                  className={toolActionClass}
                >
                  <span aria-hidden className="text-sm leading-none">
                    ＋
                  </span>
                  New note
                </button>
              )}
              {allowUpload && (
                <label
                  className={toolActionClass}
                  title="Upload files (PDF, DOCX, TXT, MD) — or drag & drop"
                >
                  <input
                    type="file"
                    multiple
                    accept={ACCEPT}
                    disabled={pending}
                    className="sr-only"
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                  <span aria-hidden className="text-sm leading-none">
                    ↑
                  </span>
                  {pending ? "Uploading…" : "Upload"}
                </label>
              )}
              {importSlot}
            </div>
          )}

          {/* File list + persistent drag & drop hint */}
          <div className="flex flex-1 flex-col overflow-y-auto p-1.5 lg:max-h-[40rem]">
            {visibleDocs.length > 0 && (
              <ul className="space-y-px">
              {visibleDocs.map((doc) => {
                const active = selected?.id === doc.id;
                return (
                  <li key={doc.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => select(doc)}
                      className={[
                        "flex w-full items-center gap-2 rounded-md py-1.5 pl-3 pr-8 text-left text-[13px] transition-colors",
                        active
                          ? "bg-navy-800/[0.07] font-medium text-navy-900"
                          : "text-navy-800/70 hover:bg-navy-800/[0.045]",
                      ].join(" ")}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-navy-800/55"
                        />
                      )}
                      <FileIcon
                        className={
                          active
                            ? "shrink-0 text-navy-800/70"
                            : "shrink-0 text-navy-800/35"
                        }
                      />
                      <span className="truncate">
                        {doc.filename ?? "Untitled"}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(doc)}
                      aria-label={`Archive ${doc.filename}`}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-navy-800/30 opacity-0 transition hover:bg-coral-400/12 hover:text-coral-400 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
              </ul>
            )}
            {visibleDocs.length === 0 && !allowUpload && (
              <p className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-navy-800/40">
                {emptyHint ?? "Nothing here yet."}
              </p>
            )}
            {allowUpload && visibleDocs.length < DROP_HINT_MAX && (
              <label
                title="Click to choose files, or drag & drop"
                className="group mt-1.5 flex flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-navy-800/15 px-4 py-10 text-center transition hover:border-sky-300 hover:bg-sky-300/10"
              >
                <input
                  type="file"
                  multiple
                  accept={ACCEPT}
                  disabled={pending}
                  className="sr-only"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
                <span
                  aria-hidden
                  className="text-xl text-navy-800/25 transition group-hover:text-sky-400"
                >
                  ⬇
                </span>
                <span className="text-sm font-semibold text-navy-800/50">
                  Drag &amp; drop here
                </span>
                <span className="text-xs text-navy-800/35">
                  or click to upload · PDF, DOCX, TXT, MD
                </span>
              </label>
            )}
          </div>

          {allowUpload && (
            <p className="border-t border-navy-800/8 px-3 py-2 text-[11px] text-navy-800/35">
              PDF, DOCX, TXT, MD · 20 MB · drag &amp; drop to add
            </p>
          )}
        </aside>

        {/* Right: preview / editor */}
        <div className="min-w-0 bg-white">
        {!selected ? (
          <p className="px-6 py-16 text-center text-sm text-navy-800/45">
            {mode === "kb"
              ? "Create a note, upload a file, or import from a website to get started."
              : "Select a file on the left to preview it."}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-navy-800/8 px-5 py-3">
              <div className="min-w-0 flex-1">
                {renaming ? (
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveName();
                      } else if (e.key === "Escape") {
                        setRenaming(false);
                      }
                    }}
                    disabled={pending}
                    className="w-full rounded-chip border border-navy-800/20 px-2.5 py-1 font-semibold outline-none focus:border-mint-700"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={startRename}
                    title="Click to rename"
                    className="group/name flex min-w-0 items-center gap-1.5 text-left"
                  >
                    <span className="truncate font-semibold">
                      {selected.filename ?? "Untitled"}
                    </span>
                    <PencilIcon className="shrink-0 text-navy-800/25 transition group-hover/name:text-mint-700" />
                  </button>
                )}
                <p className="text-xs text-navy-800/40">
                  {new Date(selected.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {selected.storage_path && !isEditable(selected)
                    ? " · uploaded document — preview only"
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={pending}
                      className="rounded-chip px-3 py-1.5 text-sm font-medium text-navy-800/55 transition hover:text-navy-900"
                    >
                      Cancel
                    </button>
                    <Button variant="small" onClick={save} disabled={pending}>
                      {pending ? "Saving…" : "Save"}
                    </Button>
                  </>
                ) : (
                  <>
                    {selected.extracted_text && (
                      <DownloadButtons
                        text={selected.extracted_text}
                        filename={(selected.filename ?? "Document").replace(
                          /\.(md|markdown|txt|pdf|docx)$/i,
                          "",
                        )}
                      />
                    )}
                    {selected.storage_path && (
                      <Button
                        variant="smallSecondary"
                        onClick={downloadOriginal}
                        disabled={pending}
                      >
                        ↓ Original
                      </Button>
                    )}
                    {isEditable(selected) && (
                      <Button variant="smallSecondary" onClick={startEdit}>
                        <span className="inline-flex items-center gap-1.5">
                          <PencilIcon /> Edit
                        </span>
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={18}
                autoFocus
                placeholder={
                  mode === "kb"
                    ? "- Prefers candidates from product companies\n- Interview process: intro call → tech screen → onsite\n- Hates job-hoppers"
                    : ""
                }
                className="block w-full resize-y border-0 bg-transparent px-5 py-4 font-mono text-[13.5px] leading-relaxed outline-none"
              />
            ) : selected.extracted_text ? (
              isMarkdownDoc(selected) ? (
                <div className="prose-calyflow max-h-[32rem] overflow-y-auto px-5 py-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.extracted_text}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap px-5 py-4 font-sans text-[14.5px] leading-relaxed">
                  {selected.extracted_text}
                </pre>
              )
            ) : (
              <p className="px-5 py-12 text-center text-sm text-navy-800/45">
                {isEditable(selected)
                  ? "Empty — click Edit to add content."
                  : "No preview available for this file type."}
              </p>
            )}
          </>
        )}
        </div>
      </div>
    </>
  );
}
