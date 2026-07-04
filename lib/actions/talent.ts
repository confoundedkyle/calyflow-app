"use server";

import { generateText } from "ai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getLanguageModel, resolveRunProviders } from "../providers";
import { getProspect } from "../queries";
import { LINKEDIN_URL_ERROR, isValidLinkedinUrl } from "../validation";
import {
  coerceAiMapping,
  PROSPECT_FIELDS,
  type ProspectField,
} from "../linkedin-csv";

export async function createProspectAction(formData: FormData): Promise<string> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Connection name is required");
  const linkedin = optional(formData.get("linkedin_url"));
  if (!isValidLinkedinUrl(linkedin)) throw new Error(LINKEDIN_URL_ERROR);
  const { data, error } = await db()
    .from("talent_prospects")
    .insert({
      workspace_id: session.workspaceId,
      name,
      job_title: optional(formData.get("job_title")),
      email: optional(formData.get("email")),
      phone: optional(formData.get("phone")),
      country: optional(formData.get("country")),
      city: optional(formData.get("city")),
      linkedin_url: linkedin,
      company: optional(formData.get("company")),
      notes: optional(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/talent-pool");
  return data.id;
}

export async function updateProspectAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Connection name is required");
  const prospect = await getProspect(session.workspaceId, id);
  if (!prospect) throw new Error("Connection not found");
  const linkedin = optional(formData.get("linkedin_url"));
  if (!isValidLinkedinUrl(linkedin)) throw new Error(LINKEDIN_URL_ERROR);
  const { error } = await db()
    .from("talent_prospects")
    .update({
      name,
      job_title: optional(formData.get("job_title")),
      email: optional(formData.get("email")),
      phone: optional(formData.get("phone")),
      country: optional(formData.get("country")),
      city: optional(formData.get("city")),
      linkedin_url: linkedin,
      company: optional(formData.get("company")),
      notes: optional(formData.get("notes")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/talent-pool");
  revalidatePath(`/talent-pool/${id}`);
}

export async function deleteProspectAction(prospectId: string) {
  const session = await requireSession();
  const prospect = await getProspect(session.workspaceId, prospectId);
  if (!prospect) throw new Error("Connection not found");

  // Remove any prospect-scoped documents (CVs) and their stored uploads.
  const { data: docs } = await db()
    .from("documents")
    .select("id, storage_path")
    .eq("workspace_id", session.workspaceId)
    .eq("scope_type", "prospect")
    .eq("scope_id", prospectId);
  const paths = (docs ?? [])
    .map((d) => d.storage_path)
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await db().storage.from("documents").remove(paths);
  }
  await db()
    .from("documents")
    .delete()
    .eq("workspace_id", session.workspaceId)
    .eq("scope_type", "prospect")
    .eq("scope_id", prospectId);

  const { error } = await db()
    .from("talent_prospects")
    .delete()
    .eq("id", prospectId);
  if (error) throw error;
  revalidatePath("/talent-pool");
}

function optional(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

// --- LinkedIn / CSV import -------------------------------------------------

/** Pull the first JSON array out of an LLM response (tolerating code fences). */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

/**
 * Map arbitrary CSV headers to our prospect fields with an LLM — the fallback
 * when an uploaded file isn't the known LinkedIn Connections format. Returns one
 * field key (or null) per header, in order. Tiny payload: headers + a few
 * sample rows only.
 */
export async function aiMapColumnsAction(
  headers: string[],
  sampleRows: string[][],
): Promise<(ProspectField | null)[]> {
  const session = await requireSession();
  const cleanHeaders = z.array(z.string()).min(1).max(60).parse(headers);
  const samples = z
    .array(z.array(z.string()))
    .max(5)
    .parse(sampleRows)
    .slice(0, 3);

  const { providers } = await resolveRunProviders(session.workspaceId);
  const primary = providers[0];
  if (!primary) {
    throw new Error(
      "No AI provider is configured, so columns can't be auto-mapped. Add one in " +
        "Settings → AI Providers, or import LinkedIn's Connections.csv export (it maps automatically).",
    );
  }
  const model = await getLanguageModel(
    primary.row.provider,
    primary.apiKey,
    primary.model,
  );

  const prompt = [
    "You map spreadsheet columns to a talent-database schema.",
    "Allowed target field keys (use these exact strings, or null when a column has no good match):",
    PROSPECT_FIELDS.join(", "),
    "Notes: `name` is a full name; `job_title` is the current role/position; " +
      "`connected_on` is the date a connection was made; `linkedin_url` is a LinkedIn profile URL.",
    `CSV headers, in order: ${JSON.stringify(cleanHeaders)}`,
    samples.length
      ? `Sample rows:\n${samples.map((r) => JSON.stringify(r)).join("\n")}`
      : "",
    `Return ONLY a JSON array of exactly ${cleanHeaders.length} items — item i is the field key (or null) for header i. No prose, no code fences.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { text } = await generateText({ model, prompt, maxOutputTokens: 600 });
  return coerceAiMapping(extractJsonArray(text), cleanHeaders.length);
}

const importRowSchema = z.object({
  name: z.string(),
  email: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  company: z.string().nullish(),
  job_title: z.string().nullish(),
  connected_on: z.string().nullish(),
  phone: z.string().nullish(),
  country: z.string().nullish(),
  city: z.string().nullish(),
  profile: z.record(z.string(), z.string()).default({}),
});

const nz = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t || null;
};

/**
 * Bulk-insert imported prospects into the talent pool. Dedupes against existing
 * rows (and within the batch) by LinkedIn URL or email, case-insensitively, and
 * skips rows without a name. Returns how many were inserted vs skipped. The
 * client sends rows in chunks, so cap the batch.
 */
export async function importProspectsAction(
  rowsInput: unknown,
): Promise<{ inserted: number; skipped: number }> {
  const session = await requireSession();
  const rows = z.array(importRowSchema).max(1000).parse(rowsInput);

  const { data: existing } = await db()
    .from("talent_prospects")
    .select("linkedin_url, email")
    .eq("workspace_id", session.workspaceId);
  const seenLinkedin = new Set<string>();
  const seenEmail = new Set<string>();
  for (const r of (existing ?? []) as { linkedin_url: string | null; email: string | null }[]) {
    if (r.linkedin_url) seenLinkedin.add(r.linkedin_url.toLowerCase());
    if (r.email) seenEmail.add(r.email.toLowerCase());
  }

  let skipped = 0;
  const toInsert: Record<string, unknown>[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) {
      skipped++;
      continue;
    }
    const li = nz(r.linkedin_url);
    const em = nz(r.email);
    const liKey = li?.toLowerCase();
    const emKey = em?.toLowerCase();
    if ((liKey && seenLinkedin.has(liKey)) || (emKey && seenEmail.has(emKey))) {
      skipped++;
      continue;
    }
    if (liKey) seenLinkedin.add(liKey);
    if (emKey) seenEmail.add(emKey);

    const connectedOn =
      r.connected_on && /^\d{4}-\d{2}-\d{2}$/.test(r.connected_on.trim())
        ? r.connected_on.trim()
        : null;
    toInsert.push({
      workspace_id: session.workspaceId,
      name,
      job_title: nz(r.job_title),
      email: em,
      phone: nz(r.phone),
      country: nz(r.country),
      city: nz(r.city),
      linkedin_url: li,
      company: nz(r.company),
      connected_on: connectedOn,
      profile: r.profile ?? {},
    });
  }

  if (toInsert.length > 0) {
    const { error } = await db().from("talent_prospects").insert(toInsert);
    if (error) throw error;
  }
  revalidatePath("/talent-pool");
  return { inserted: toInsert.length, skipped };
}
