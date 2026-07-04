"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  createProspectAction,
  deleteProspectAction,
  updateProspectAction,
} from "@/lib/actions/talent";
import { uploadDocumentAction } from "@/lib/actions/documents";
import { isValidLinkedinUrl, LINKEDIN_URL_ERROR } from "@/lib/validation";
import type { TalentProspect } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  inputClass,
} from "@/components/ui";
import { CountrySelect, PhoneInput } from "@/components/pickers";
import { FileDrop } from "@/components/file-drop";
import { LinkedInImportCard } from "@/components/linkedin-import";
import { useToast } from "@/components/use-toast";

export function TalentProspects({
  prospects,
}: {
  prospects: TalentProspect[];
}) {
  const [adding, setAdding] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cv, setCv] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, showToast } = useToast();

  const q = query.trim().toLowerCase();
  const visible = q
    ? prospects.filter((p) =>
        [p.name, p.email, p.city, p.country, p.notes, p.company, p.job_title]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    : prospects;

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (!isValidLinkedinUrl(String(formData.get("linkedin_url") ?? ""))) {
      setError(LINKEDIN_URL_ERROR);
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        const prospectId = await createProspectAction(formData);
        if (cv) {
          const fd = new FormData();
          fd.set("scopeType", "prospect");
          fd.set("scopeId", prospectId);
          fd.set("kind", "file");
          fd.set("docType", "cv");
          fd.set("file", cv);
          await uploadDocumentAction(fd);
        }
        setAdding(false);
        setCv(null);
        showToast(cv ? "Connection added with CV" : "Connection added");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add connection");
      }
    });
  }

  return (
    <>
      <PageHeader
        title="LinkedIn Connections"
        description="Track people your team knows from LinkedIn imports — open one to attach a CV."
        action={
          <div className="flex gap-2">
            <Button
              variant="smallSecondary"
              onClick={() => {
                setImportingCsv((v) => !v);
                setAdding(false);
              }}
            >
              {importingCsv ? "Close" : "Import from LinkedIn"}
            </Button>
            <Button
              variant="small"
              onClick={() => {
                setAdding((v) => !v);
                setImportingCsv(false);
              }}
            >
              {adding ? "Close" : "Add connection"}
            </Button>
          </div>
        }
      />

      {importingCsv && (
        <LinkedInImportCard
          onDone={(message) => {
            setImportingCsv(false);
            showToast(message);
          }}
        />
      )}

      {adding && (
        <Card className="mb-5">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Job title">
              <input
                name="job_title"
                className={inputClass}
                placeholder="e.g. Senior Python Engineer"
              />
            </Field>
            <Field label="Company">
              <input
                name="company"
                className={inputClass}
                placeholder="Current employer"
              />
            </Field>
            <Field label="LinkedIn URL">
              <input
                name="linkedin_url"
                className={inputClass}
                placeholder="https://linkedin.com/in/…"
              />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <PhoneInput />
            <CountrySelect />
            <Field label="City">
              <input name="city" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes (skills, abilities, context)">
                <textarea name="notes" rows={3} className={inputClass} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <FileDrop
                file={cv}
                onFile={setCv}
                disabled={pending}
                label="CV (optional)"
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" variant="small" disabled={pending}>
                {pending ? "Adding…" : "Add connection"}
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

      {prospects.length === 0 ? (
        !adding && (
          <EmptyState
            title="No connections yet"
            description="Add your first LinkedIn connection — open their profile afterwards to attach a CV."
            action={
              <Button variant="small" onClick={() => setAdding(true)}>
                Add connection
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connections…"
              aria-label="Search connections"
              className={`${inputClass} max-w-md`}
            />
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-navy-800/45">
              No matches.{" "}
              <button
                type="button"
                onClick={() => setQuery("")}
                className="font-semibold text-mint-700 hover:underline"
              >
                Clear search
              </button>
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((prospect) => (
                <ProspectRow
                  key={prospect.id}
                  prospect={prospect}
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

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2023-07-18" → "18 Jul 2023" (no timezone math, just the stored date). */
function formatConnectedOn(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTH_ABBR[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function ProspectRow({
  prospect,
  showToast,
}: {
  prospect: TalentProspect;
  showToast: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (
      !window.confirm(
        `Delete "${prospect.name}" and any attached CV? This cannot be undone.`,
      )
    )
      return;
    startTransition(async () => {
      try {
        setError(null);
        await deleteProspectAction(prospect.id);
        showToast("Connection deleted");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete");
      }
    });
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (!isValidLinkedinUrl(String(formData.get("linkedin_url") ?? ""))) {
      setError(LINKEDIN_URL_ERROR);
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        await updateProspectAction(formData);
        showToast("Connection updated");
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
          <input type="hidden" name="id" value={prospect.id} />
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={prospect.name}
              className={inputClass}
            />
          </Field>
          <Field label="Job title">
            <input
              name="job_title"
              defaultValue={prospect.job_title ?? ""}
              className={inputClass}
              placeholder="e.g. Senior Python Engineer"
            />
          </Field>
          <Field label="Company">
            <input
              name="company"
              defaultValue={prospect.company ?? ""}
              className={inputClass}
              placeholder="Current employer"
            />
          </Field>
          <Field label="LinkedIn URL">
            <input
              name="linkedin_url"
              defaultValue={prospect.linkedin_url ?? ""}
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              defaultValue={prospect.email ?? ""}
              className={inputClass}
            />
          </Field>
          <PhoneInput defaultValue={prospect.phone ?? ""} />
          <CountrySelect defaultValue={prospect.country ?? ""} />
          <Field label="City">
            <input
              name="city"
              defaultValue={prospect.city ?? ""}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes (skills, abilities, context)">
              <textarea
                name="notes"
                rows={3}
                defaultValue={prospect.notes ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
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

  const location = [prospect.city, prospect.country].filter(Boolean).join(", ");

  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Link
          href={`/talent-pool/${prospect.id}`}
          className="font-semibold underline-offset-4 hover:text-mint-700 hover:underline"
        >
          {prospect.name}
        </Link>
        {(prospect.job_title || prospect.company) && (
          <p className="mt-0.5 text-sm font-medium text-navy-800/70">
            {[prospect.job_title, prospect.company].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="mt-0.5 text-sm text-navy-800/55">
          {[location, prospect.email, prospect.phone]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        {prospect.connected_on && (
          <p className="mt-0.5 text-xs text-navy-800/40">
            Connected {formatConnectedOn(prospect.connected_on)}
          </p>
        )}
        {prospect.notes && (
          <p className="mt-1 line-clamp-2 text-sm text-navy-800/45">
            {prospect.notes}
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
