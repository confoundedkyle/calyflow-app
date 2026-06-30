"use server";

import { generateText } from "ai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "../auth";
import { db } from "../db";
import { getConnection, getProject, listConnections } from "../queries";
import { getValidAccessToken } from "../integrations";
import { getLanguageModel, resolveRunProviders } from "../providers";
import {
  LIVE_EMAIL_ENRICHMENT_PROVIDERS,
  connectorLabel,
} from "../connectors";
import { connectedProvidersFrom } from "../run-items";
import { findEmailViaProvider } from "../enrichment/find-email";
import {
  ENRICHMENT_FIELDS,
  canonicalLinkedinUrl,
  coerceEnrichmentMapping,
  detectHeader,
  heuristicEnrichmentMapping,
  mappingHasEmail,
  normalizeLinkedinUrl,
  parseCsv,
  rowsToEnrichmentRecords,
  type EnrichmentField,
} from "../enrichment/csv";
import type { Candidate } from "../types";

/** A candidate row scoped + verified to the caller's workspace. */
async function loadCandidate(
  workspaceId: string,
  candidateId: string,
): Promise<Candidate> {
  const { data } = await db()
    .from("candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (!data || (data as Candidate).workspace_id !== workspaceId) {
    throw new Error("Candidate not found");
  }
  return data as Candidate;
}

function mergeRaw(
  existing: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...extra };
}

export interface FindEmailActionResult {
  email: string | null;
  /** Display name of the provider that ran. */
  provider: string;
}

/**
 * One-click email lookup for a single candidate (the Shortlist "Find email"
 * button). Picks the workspace's first connected live-enrichment connector,
 * enriches by the candidate's LinkedIn URL, and saves the email. Throws a
 * user-friendly error when nothing is connected or the candidate has no
 * LinkedIn URL — the UI catches it and opens the enrichment dialog instead.
 */
export async function findCandidateEmailAction(
  candidateId: string,
): Promise<FindEmailActionResult> {
  const session = await requireSession();
  const candidate = await loadCandidate(session.workspaceId, candidateId);

  if (candidate.email) {
    return { email: candidate.email, provider: "" };
  }
  if (!candidate.linkedin?.trim()) {
    throw new Error(
      "This candidate has no LinkedIn URL, so there's nothing to look up.",
    );
  }

  const connected = connectedProvidersFrom(
    await listConnections(session.workspaceId),
  );
  const provider = LIVE_EMAIL_ENRICHMENT_PROVIDERS.find((p) =>
    connected.has(p),
  );
  if (!provider) {
    throw new Error("NO_ENRICHMENT_TOOL");
  }

  const connection = await getConnection(session.workspaceId, provider);
  if (!connection) throw new Error("NO_ENRICHMENT_TOOL");
  const token = await getValidAccessToken(connection);

  // Use the canonical, slash-terminated URL so the provider pairs the profile
  // even for candidates stored before we started canonicalizing on save.
  const lookupUrl =
    canonicalLinkedinUrl(candidate.linkedin) ?? candidate.linkedin.trim();
  const { email, detail } = await findEmailViaProvider(
    provider,
    token,
    lookupUrl,
  );

  if (email) {
    const { error } = await db()
      .from("candidates")
      .update({
        email,
        raw: mergeRaw(candidate.raw, {
          email_source: provider,
          email_enriched_at: new Date().toISOString(),
        }),
      })
      .eq("id", candidate.id);
    if (error) throw error;

    const project = await getProject(session.workspaceId, candidate.project_id);
    if (project) {
      revalidatePath(
        `/clients/${project.client_id}/projects/${candidate.project_id}/shortlist`,
      );
    }
  } else {
    // Record the miss so a later run knows we already tried this provider.
    await db()
      .from("candidates")
      .update({
        raw: mergeRaw(candidate.raw, {
          email_lookup_miss: provider,
          email_lookup_detail: detail.slice(0, 500),
        }),
      })
      .eq("id", candidate.id);
  }

  return { email, provider: connectorLabel(provider) };
}

export interface ImportEmailsActionResult {
  /** Candidates whose (previously empty) email we filled in. */
  updated: number;
  /** Matched candidates that already had an email — extra data still merged. */
  enriched: number;
  /** Rows whose data matched no candidate in this project. */
  unmatched: number;
  /** Whether the column mapping was produced by the AI agent (vs. heuristic). */
  usedAi: boolean;
}

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
 * Map an enriched CSV's columns to our fields with an LLM — the "resourceful"
 * path that copes with any tool's column names (ContactOut's "Personal Email" /
 * "Work Email" / "Work Email Status", Hunter's layout, etc.). Returns one field
 * key (or null) per header, or null when no AI provider is configured so the
 * caller falls back to the heuristic mapping. Tiny payload: headers + a few
 * sample rows.
 */
async function aiEnrichmentColumnMapping(
  workspaceId: string,
  headers: string[],
  sampleRows: string[][],
): Promise<(EnrichmentField | null)[] | null> {
  const { providers } = await resolveRunProviders(workspaceId);
  const primary = providers[0];
  if (!primary) return null;

  const model = await getLanguageModel(
    primary.row.provider,
    primary.apiKey,
    primary.model,
  );
  const samples = sampleRows.slice(0, 3);
  const prompt = [
    "You map spreadsheet columns from a contact-enrichment export to a schema.",
    "Allowed target field keys (use these exact strings, or null when a column has no good match):",
    ENRICHMENT_FIELDS.join(", "),
    "Notes:",
    "- personal_email = a personal address (e.g. @gmail.com, @yahoo.com); a column may hold several, comma-separated.",
    "- work_email = a work/business/company address.",
    "- other_email = an email column that isn't clearly personal or work.",
    "- Do NOT map status/validation/quality columns (e.g. \"Work Email Status\", \"Email Validity\") — return null for those.",
    "- calyflow_id = our own id column; linkedin_url = a LinkedIn profile URL; name = full name; phone = phone/mobile.",
    `CSV headers, in order: ${JSON.stringify(headers)}`,
    samples.length
      ? `Sample rows:\n${samples.map((r) => JSON.stringify(r)).join("\n")}`
      : "",
    `Return ONLY a JSON array of exactly ${headers.length} items — item i is the field key (or null) for header i. No prose, no code fences.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { text } = await generateText({ model, prompt, maxOutputTokens: 600 });
  return coerceEnrichmentMapping(extractJsonArray(text), headers.length);
}

/**
 * Import an enriched CSV back onto the project's candidates. Columns are mapped
 * by the AI agent (heuristic fallback), so any tool's export works. For each
 * matched candidate (by `calyflow_id`, else normalized LinkedIn URL) we fill the
 * email when it's empty — preferring a personal address when several are
 * present — and merge ALL of the enriched data (every email, phone, and the
 * remaining columns) onto the candidate's record for later use in the talent
 * pool. Never clobbers an email a candidate already has.
 */
export async function importEnrichedCsvAction(
  projectId: string,
  csvText: string,
): Promise<ImportEmailsActionResult> {
  const session = await requireSession();
  const project = await getProject(session.workspaceId, projectId);
  if (!project) throw new Error("Project not found");

  const text = z.string().min(1).max(2_000_000).parse(csvText);
  const table = parseCsv(text);
  const header = detectHeader(table);
  if (!header) throw new Error("That file looks empty.");
  const headers = header.cells;
  const dataRows = table.slice(header.index + 1);

  // Prefer the AI mapping; fall back to the heuristic if there's no provider or
  // the AI mapping didn't find an email column.
  let usedAi = false;
  let mapping = heuristicEnrichmentMapping(headers);
  try {
    const ai = await aiEnrichmentColumnMapping(
      session.workspaceId,
      headers,
      dataRows,
    );
    if (ai && mappingHasEmail(ai)) {
      mapping = ai;
      usedAi = true;
    }
  } catch (err) {
    console.warn("AI column mapping failed, using heuristic:", err);
  }
  if (!mappingHasEmail(mapping)) {
    throw new Error(
      "Couldn't find an email column in that file. Make sure the enriched CSV has a column with email addresses.",
    );
  }

  const records = rowsToEnrichmentRecords(dataRows, headers, mapping);
  if (records.length === 0) {
    throw new Error(
      "No email addresses found in that file. Did the enrichment tool fill an email column?",
    );
  }

  const { data, error } = await db()
    .from("candidates")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw error;
  const candidates = (data ?? []) as Candidate[];

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const byLinkedin = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = normalizeLinkedinUrl(c.linkedin);
    if (key) byLinkedin.set(key, c);
  }

  let updated = 0;
  let enriched = 0;
  let unmatched = 0;
  const handled = new Set<string>(); // a candidate is written at most once

  for (const rec of records) {
    const match =
      (rec.id ? byId.get(rec.id) : undefined) ??
      byLinkedin.get(normalizeLinkedinUrl(rec.linkedin));
    if (!match) {
      unmatched++;
      continue;
    }
    if (handled.has(match.id)) continue;
    handled.add(match.id);

    const fillEmail = !match.email?.trim();
    const raw = mergeRaw(match.raw, {
      email_source: "csv_import",
      email_enriched_at: new Date().toISOString(),
      enrichment: {
        personal_emails: rec.emails.personal,
        work_emails: rec.emails.work,
        other_emails: rec.emails.other,
        phone: rec.phone,
        fields: rec.extra,
      },
    });
    const { error: upErr } = await db()
      .from("candidates")
      .update(fillEmail ? { email: rec.primaryEmail, raw } : { raw })
      .eq("id", match.id);
    if (upErr) throw upErr;
    if (fillEmail) updated++;
    else enriched++;
  }

  if (updated + enriched > 0) {
    revalidatePath(
      `/clients/${project.client_id}/projects/${projectId}/shortlist`,
    );
  }

  return { updated, enriched, unmatched, usedAi };
}
