"use client";

import { useState, useTransition } from "react";
import {
  createCandidateAction,
  deleteCandidateAction,
  updateCandidateAction,
} from "@/lib/actions/ats";
import type { AtsCandidateStatus } from "@/lib/types";
import type { AtsCandidateWithProject } from "@/lib/queries";
import type { ClientWithProjects } from "@/components/sidebar-nav";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  PageHeader,
  inputClass,
} from "@/components/ui";
import { PhoneInput } from "@/components/pickers";
import { useToast } from "@/components/use-toast";

const STATUSES: AtsCandidateStatus[] = [
  "sourced",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
];

const STATUS_TONE: Record<
  AtsCandidateStatus,
  "navy" | "sky" | "mint" | "amber" | "coral"
> = {
  sourced: "navy",
  screening: "sky",
  interview: "amber",
  offer: "amber",
  hired: "mint",
  rejected: "coral",
};

function ProjectOptions({ clients }: { clients: ClientWithProjects[] }) {
  return (
    <>
      <option value="">— No role —</option>
      {clients.map((client) => (
        <optgroup key={client.id} label={client.name}>
          {client.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function AtsCandidates({
  candidates,
  clients,
}: {
  candidates: AtsCandidateWithProject[];
  clients: ClientWithProjects[];
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | AtsCandidateStatus>("all");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, showToast } = useToast();

  const q = query.trim().toLowerCase();
  const visible = candidates.filter((c) => {
    if (status !== "all" && c.status !== status) return false;
    if (!q) return true;
    return [c.name, c.email, c.project?.name, c.project?.client?.name, c.notes]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        setError(null);
        await createCandidateAction(formData);
        setAdding(false);
        showToast("Candidate added");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add candidate");
      }
    });
  }

  return (
    <>
      <PageHeader
        title="ATS"
        description="Track candidates and associate them with the roles (projects) you're hiring for."
        action={
          <Button variant="small" onClick={() => setAdding((v) => !v)}>
            {adding ? "Close" : "Add candidate"}
          </Button>
        }
      />

      {adding && (
        <Card className="mb-5">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Role">
              <select name="project_id" className={inputClass} defaultValue="">
                <ProjectOptions clients={clients} />
              </select>
            </Field>
            <Field label="Email">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <PhoneInput />
            <Field label="Status">
              <select
                name="status"
                className={inputClass}
                defaultValue="sourced"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={3} className={inputClass} />
            </Field>
            <div className="flex items-end gap-3 sm:col-span-2">
              <Button type="submit" variant="small" disabled={pending}>
                {pending ? "Adding…" : "Add candidate"}
              </Button>
              {error && (
                <p role="alert" className="text-xs text-coral-400">
                  {error}
                </p>
              )}
            </div>
          </form>
        </Card>
      )}

      {candidates.length === 0 ? (
        !adding && (
          <EmptyState
            title="No candidates yet"
            description="Add your first candidate and track them through the pipeline."
            action={
              <Button variant="small" onClick={() => setAdding(true)}>
                Add candidate
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search candidates…"
              aria-label="Search candidates"
              className={`${inputClass} max-w-xs`}
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "all" | AtsCandidateStatus)
              }
              aria-label="Filter by status"
              className={`${inputClass} max-w-[12rem]`}
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-navy-800/45">
              No matches.{" "}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
                className="font-semibold text-mint-700 hover:underline"
              >
                Clear filters
              </button>
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  clients={clients}
                  showToast={showToast}
                />
              ))}
            </div>
          )}
        </>
      )}

      {toast}
    </>
  );
}

function CandidateRow({
  candidate,
  clients,
  showToast,
}: {
  candidate: AtsCandidateWithProject;
  clients: ClientWithProjects[];
  showToast: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Delete "${candidate.name}"? This cannot be undone.`))
      return;
    startTransition(async () => {
      try {
        setError(null);
        await deleteCandidateAction(candidate.id);
        showToast("Candidate deleted");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete");
      }
    });
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        setError(null);
        await updateCandidateAction(formData);
        showToast("Candidate updated");
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    });
  }

  if (editing) {
    return (
      <Card>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={candidate.id} />
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={candidate.name}
              className={inputClass}
            />
          </Field>
          <Field label="Role">
            <select
              name="project_id"
              className={inputClass}
              defaultValue={candidate.project_id ?? ""}
            >
              <ProjectOptions clients={clients} />
            </select>
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              defaultValue={candidate.email ?? ""}
              className={inputClass}
            />
          </Field>
          <PhoneInput defaultValue={candidate.phone ?? ""} />
          <Field label="Status">
            <select
              name="status"
              className={inputClass}
              defaultValue={candidate.status}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              name="notes"
              rows={3}
              defaultValue={candidate.notes ?? ""}
              className={inputClass}
            />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" variant="small" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="smallSecondary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            {error && (
              <p role="alert" className="text-xs text-coral-400">
                {error}
              </p>
            )}
          </div>
        </form>
      </Card>
    );
  }

  const role = candidate.project
    ? [candidate.project.client?.name, candidate.project.name]
        .filter(Boolean)
        .join(" — ")
    : null;

  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{candidate.name}</p>
          <Chip tone={STATUS_TONE[candidate.status]}>{candidate.status}</Chip>
        </div>
        <p className="mt-0.5 text-sm text-navy-800/55">
          {[role, candidate.email, candidate.phone].filter(Boolean).join(" · ") ||
            "—"}
        </p>
        {candidate.notes && (
          <p className="mt-1 line-clamp-2 text-sm text-navy-800/45">
            {candidate.notes}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-coral-400">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          className="rounded-chip border border-navy-800/15 px-2.5 py-1 text-xs font-semibold text-navy-800/65 transition hover:border-navy-800/35 hover:text-navy-900 disabled:opacity-40"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-chip border border-navy-800/15 px-2.5 py-1 text-xs font-medium text-navy-800/45 transition hover:border-coral-400/50 hover:text-coral-400 disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </Card>
  );
}
