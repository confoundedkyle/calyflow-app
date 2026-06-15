"use client";

import { useState, useTransition } from "react";
import {
  createLeadAction,
  deleteLeadAction,
  updateLeadAction,
} from "@/lib/actions/crm";
import type { CrmAccount, CrmLeadStatus } from "@/lib/types";
import type { CrmLeadWithAccount } from "@/lib/queries";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  inputClass,
} from "@/components/ui";
import { PhoneInput } from "@/components/pickers";
import { useToast } from "@/components/use-toast";

const STATUSES: CrmLeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
];

const STATUS_TONE: Record<CrmLeadStatus, "navy" | "sky" | "mint" | "coral"> = {
  new: "navy",
  contacted: "sky",
  qualified: "mint",
  won: "mint",
  lost: "coral",
};

export function CrmLeads({
  leads,
  accounts,
}: {
  leads: CrmLeadWithAccount[];
  accounts: CrmAccount[];
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CrmLeadStatus>("all");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, showToast } = useToast();

  const q = query.trim().toLowerCase();
  const visible = leads.filter((lead) => {
    if (status !== "all" && lead.status !== status) return false;
    if (!q) return true;
    return [lead.name, lead.email, lead.title, lead.account?.name, lead.notes]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        setError(null);
        await createLeadAction(formData);
        setAdding(false);
        showToast("Lead added");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add lead");
      }
    });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Leads</h2>
        <Button variant="small" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Add lead"}
        </Button>
      </div>

      {adding && (
        <Card className="mb-5">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Account">
              <select name="account_id" className={inputClass} defaultValue="">
                <option value="">— No account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Email">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <PhoneInput />
            <Field label="Title">
              <input name="title" className={inputClass} />
            </Field>
            <Field label="Status">
              <select name="status" className={inputClass} defaultValue="new">
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
                {pending ? "Adding…" : "Add lead"}
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

      {leads.length === 0 ? (
        !adding && (
          <EmptyState
            title="No leads yet"
            description="Add the people you're talking to and track them from first contact to won."
            action={
              <Button variant="small" onClick={() => setAdding(true)}>
                Add lead
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
              placeholder="Search leads…"
              aria-label="Search leads"
              className={`${inputClass} max-w-xs`}
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "all" | CrmLeadStatus)
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
              {visible.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  accounts={accounts}
                  showToast={showToast}
                />
              ))}
            </div>
          )}
        </>
      )}

      {toast}
    </section>
  );
}

function LeadRow({
  lead,
  accounts,
  showToast,
}: {
  lead: CrmLeadWithAccount;
  accounts: CrmAccount[];
  showToast: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Delete "${lead.name}"? This cannot be undone.`))
      return;
    startTransition(async () => {
      try {
        setError(null);
        await deleteLeadAction(lead.id);
        showToast("Lead deleted");
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
        await updateLeadAction(formData);
        showToast("Lead updated");
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
          <input type="hidden" name="id" value={lead.id} />
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={lead.name}
              className={inputClass}
            />
          </Field>
          <Field label="Account">
            <select
              name="account_id"
              className={inputClass}
              defaultValue={lead.account_id ?? ""}
            >
              <option value="">— No account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              defaultValue={lead.email ?? ""}
              className={inputClass}
            />
          </Field>
          <PhoneInput defaultValue={lead.phone ?? ""} />
          <Field label="Title">
            <input
              name="title"
              defaultValue={lead.title ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Status">
            <select
              name="status"
              className={inputClass}
              defaultValue={lead.status}
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
              defaultValue={lead.notes ?? ""}
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

  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{lead.name}</p>
          <Chip tone={STATUS_TONE[lead.status]}>{lead.status}</Chip>
        </div>
        <p className="mt-0.5 text-sm text-navy-800/55">
          {[lead.title, lead.account?.name, lead.email, lead.phone]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        {lead.notes && (
          <p className="mt-1 line-clamp-2 text-sm text-navy-800/45">
            {lead.notes}
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
