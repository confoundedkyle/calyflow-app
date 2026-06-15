"use client";

import { useRef, useState } from "react";

const ACCEPT = ".pdf,.docx,.txt,.md";
const ALLOWED_EXT = ["pdf", "docx", "txt", "md"];
const MAX_BYTES = 20 * 1024 * 1024;

const labelClass = "mb-1.5 block text-sm font-semibold text-navy-800/80";

/**
 * A single-file picker with click + drag-and-drop. It only *selects* a file
 * (validating type/size) and hands it back via `onFile`; the caller decides
 * when to upload. Mirrors the drag handling used in doc-explorer.
 */
export function FileDrop({
  file,
  onFile,
  disabled = false,
  label = "Attachment (optional)",
  hint = "PDF, DOCX, TXT, MD · 20 MB max",
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(picked: File | undefined | null) {
    if (!picked) return;
    const ext = picked.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.includes(ext)) {
      setError("Unsupported file type — use PDF, DOCX, TXT, or MD.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError("File too large (20 MB max).");
      return;
    }
    setError(null);
    onFile(picked);
  }

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  function onDragEnter(e: React.DragEvent) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault(); // required so the drop event fires
  }
  function onDragLeave(e: React.DragEvent) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setOver(false);
    }
  }
  function onDrop(e: React.DragEvent) {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    accept(e.dataTransfer?.files?.[0]);
  }

  return (
    <div className="block">
      <span className={labelClass}>{label}</span>
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center transition ${
          over
            ? "border-sky-300 bg-sky-300/20"
            : "border-navy-800/20 bg-white"
        }`}
      >
        {file ? (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span aria-hidden>📄</span>
            <span className="font-medium text-navy-800/80">{file.name}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onFile(null);
                setError(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="rounded-chip border border-navy-800/15 px-2 py-0.5 text-xs font-medium text-navy-800/55 transition hover:border-coral-400/50 hover:text-coral-400 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <span aria-hidden className="text-xl text-navy-800/40">
              ⬆
            </span>
            <p className="text-sm text-navy-800/55">
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="font-semibold text-mint-700 hover:underline disabled:opacity-40"
              >
                Choose a file
              </button>{" "}
              or drag &amp; drop
            </p>
            <p className="text-xs text-navy-800/40">{hint}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-coral-400">{error}</p>}
    </div>
  );
}
