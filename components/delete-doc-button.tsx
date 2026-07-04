"use client";

import { useTransition } from "react";
import { archiveDocumentAction } from "@/lib/actions/documents";

export function DeleteDocButton({
  docId,
  filename,
}: {
  docId: string;
  filename: string | null;
}) {
  const [pending, startTransition] = useTransition();

  function remove() {
    if (
      !window.confirm(
        `Archive "${filename ?? "Untitled"}"? It will be hidden from active document lists.`,
      )
    )
      return;
    startTransition(async () => {
      await archiveDocumentAction(docId);
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      className="text-sm text-navy-800/40 transition hover:text-coral-400 disabled:opacity-40"
      aria-label={`Archive ${filename ?? "Untitled"}`}
    >
      ✕
    </button>
  );
}
