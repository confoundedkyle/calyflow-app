import "server-only";
import type { ConnectorAdapter } from "./types";

// FullEnrich (B2B email + phone waterfall enrichment across 15+ vendors). Auth
// is a static API key (FullEnrich: app → API) sent as a Bearer token. Like
// Dropcontact, enrichment is async: POST /contact/enrich/bulk returns an
// enrichment_id and GET /contact/enrich/bulk/{id} is polled until status is
// FINISHED — the same pending/poll shape as the Snov.io and Dropcontact tools.
// The finished payload nests the resolved contact under datas[0].contact with
// emails/phones arrays (item shapes vary by vendor), so rendering pulls the
// first of each with a capped raw-JSON fallback. validateApiKey GETs a dummy
// enrichment id and treats 401/403 as a bad key — a credit-free check, since
// there's no list endpoint.
const API = "https://app.fullenrich.com/api/v2";

const CHAR_CAP = 8_000;
const FINISHED = new Set(["FINISHED", "finished", "completed", "COMPLETED"]);

export interface FullenrichContact {
  firstName?: string;
  lastName?: string;
  company?: string;
  domain?: string;
  linkedinUrl?: string;
}

export interface FullenrichAdapter extends ConnectorAdapter {
  enrich(
    apiKey: string,
    contact: FullenrichContact,
  ): Promise<{ text: string; pending: boolean }>;
  getResult(
    apiKey: string,
    args: { enrichmentId: string },
  ): Promise<{ text: string; pending: boolean }>;
}

interface ContactValue {
  email?: string;
  number?: string;
  phone?: string;
}
interface EnrichedRow {
  firstname?: string | null;
  lastname?: string | null;
  company_name?: string | null;
  contact?: {
    emails?: (ContactValue | string)[] | null;
    phones?: (ContactValue | string)[] | null;
  } | null;
  emails?: (ContactValue | string)[] | null;
  phones?: (ContactValue | string)[] | null;
}
interface EnrichResponse {
  enrichment_id?: string;
  id?: string;
  status?: string;
  datas?: EnrichedRow[];
  message?: string;
  error?: string;
}

async function request(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<EnrichResponse> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const json = (await res.json().catch(() => null)) as EnrichResponse | null;
  if (!res.ok) {
    const detail = json?.message ?? json?.error ?? res.statusText;
    throw new Error(`FullEnrich error (${res.status}): ${detail}`);
  }
  return json ?? {};
}

function renderLoose(value: unknown): string {
  const s = JSON.stringify(value, null, 1) ?? String(value);
  return s.length > CHAR_CAP ? `${s.slice(0, CHAR_CAP)}\n…(truncated)` : s;
}

function firstOf(
  values: (ContactValue | string)[] | null | undefined,
  key: "email" | "number",
): string {
  const v = values?.[0];
  if (!v) return "";
  if (typeof v === "string") return v;
  return v[key] ?? v.phone ?? "";
}

function renderRow(row: EnrichedRow): string {
  const name = [row.firstname, row.lastname].filter(Boolean).join(" ");
  const emails = row.contact?.emails ?? row.emails;
  const phones = row.contact?.phones ?? row.phones;
  const email = firstOf(emails, "email");
  const phone = firstOf(phones, "number");
  const headline = `**${name || "Unknown"}**${
    row.company_name ? ` at ${row.company_name}` : ""
  }`;
  const lines = [headline];
  if (email) lines.push(`Email: ${email}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (!email && !phone) return renderLoose(row);
  return lines.join("\n");
}

export const fullenrichAdapter: FullenrichAdapter = {
  provider: "fullenrich",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // No list/account endpoint — GET a dummy id and read the status code:
    // 401/403 means a bad key; anything else (404 for the unknown id) means
    // the key authenticated. Consumes no credits.
    try {
      const res = await fetch(
        `${API}/contact/enrich/bulk/00000000-0000-0000-0000-000000000000`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "FullEnrich rejected the API key (check it in app → API)." };
      }
      return { ok: true, accountLabel: "FullEnrich" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async enrich(apiKey, contact) {
    const row: Record<string, string> = {};
    if (contact.firstName) row.firstname = contact.firstName;
    if (contact.lastName) row.lastname = contact.lastName;
    if (contact.company) row.company_name = contact.company;
    if (contact.domain) row.domain = contact.domain;
    if (contact.linkedinUrl) row.linkedin_url = contact.linkedinUrl;
    if (Object.keys(row).length === 0) {
      return {
        text: "Provide at least firstName + lastName with a company/domain, or a linkedinUrl.",
        pending: false,
      };
    }
    const started = await request(apiKey, "POST", "/contact/enrich/bulk", {
      name: "Calyflow enrichment",
      datas: [row],
    });
    const id = started.enrichment_id ?? started.id;
    if (!id) return { text: renderLoose(started), pending: false };
    return {
      text: `FullEnrich accepted the enrichment (enrichment id ${id}). Call fullenrich_get_result with that id in a few seconds to read the result.`,
      pending: true,
    };
  },

  async getResult(apiKey, args) {
    if (!args.enrichmentId) return { text: "Provide the enrichmentId.", pending: false };
    const json = await request(
      apiKey,
      "GET",
      `/contact/enrich/bulk/${encodeURIComponent(args.enrichmentId)}`,
    );
    const finished = json.status ? FINISHED.has(json.status) : !!json.datas;
    if (!finished) {
      return {
        text: `FullEnrich is still enriching this request (enrichment id ${
          json.enrichment_id ?? json.id ?? args.enrichmentId
        }, status ${json.status ?? "pending"}). Call fullenrich_get_result again after working on something else for a moment.`,
        pending: true,
      };
    }
    const row = json.datas?.[0];
    if (!row) return { text: "_No enrichment returned._", pending: false };
    return { text: renderRow(row), pending: false };
  },
};
