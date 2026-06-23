import "server-only";
import type { ConnectorAdapter } from "./types";

// Surfe (people + company enrichment — email, mobile, job history). Auth is a
// static API key sent as a Bearer token. Like Dropcontact/FullEnrich the
// enrichment is async: POST /v2/people/enrich returns an enrichmentID and
// GET /v2/people/enrich/{id} is polled until status is COMPLETED — the same
// pending/poll shape as the other waterfall enrichers. The enriched person
// carries emails and mobilePhones arrays whose item shapes vary, so rendering
// pulls the first of each tolerantly. validateApiKey GETs a dummy id and treats
// 401/403 as a bad key (credit-free).
const API = "https://api.surfe.com";

const CHAR_CAP = 8_000;
const FINISHED = new Set(["COMPLETED", "completed", "DONE", "done"]);

export interface SurfeContact {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyDomain?: string;
  linkedinUrl?: string;
}

export interface SurfeAdapter extends ConnectorAdapter {
  enrich(
    apiKey: string,
    contact: SurfeContact,
  ): Promise<{ text: string; pending: boolean }>;
  getResult(
    apiKey: string,
    args: { enrichmentId: string },
  ): Promise<{ text: string; pending: boolean }>;
}

interface ContactValue {
  email?: string;
  mobilePhone?: string;
  number?: string;
}
interface EnrichedPerson {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  emails?: (ContactValue | string)[] | null;
  mobilePhones?: (ContactValue | string)[] | null;
  email?: string | null;
  mobilePhone?: string | null;
}
interface EnrichResponse {
  enrichmentID?: string;
  id?: string;
  status?: string;
  people?: EnrichedPerson[];
  message?: string;
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
    const detail = json?.message ?? res.statusText;
    throw new Error(`Surfe error (${res.status}): ${detail}`);
  }
  return json ?? {};
}

function renderLoose(value: unknown): string {
  const s = JSON.stringify(value, null, 1) ?? String(value);
  return s.length > CHAR_CAP ? `${s.slice(0, CHAR_CAP)}\n…(truncated)` : s;
}

function firstEmail(p: EnrichedPerson): string {
  if (p.email) return p.email;
  const v = p.emails?.[0];
  if (!v) return "";
  return typeof v === "string" ? v : (v.email ?? "");
}
function firstMobile(p: EnrichedPerson): string {
  if (p.mobilePhone) return p.mobilePhone;
  const v = p.mobilePhones?.[0];
  if (!v) return "";
  return typeof v === "string" ? v : (v.mobilePhone ?? v.number ?? "");
}

export const surfeAdapter: SurfeAdapter = {
  provider: "surfe",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // No simple account read — GET a dummy enrichment id; 401/403 means a bad
    // key, anything else (404 for the unknown id) means the key authenticated.
    try {
      const res = await fetch(
        `${API}/v2/people/enrich/00000000-0000-0000-0000-000000000000`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Surfe rejected the API key (check it in the Surfe app → API)." };
      }
      return { ok: true, accountLabel: "Surfe" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async enrich(apiKey, contact) {
    const person: Record<string, string> = {};
    if (contact.firstName) person.firstName = contact.firstName;
    if (contact.lastName) person.lastName = contact.lastName;
    if (contact.companyName) person.companyName = contact.companyName;
    if (contact.companyDomain) person.companyDomain = contact.companyDomain;
    if (contact.linkedinUrl) person.linkedinUrl = contact.linkedinUrl;
    if (!person.linkedinUrl && !(person.firstName && person.lastName && (person.companyName || person.companyDomain))) {
      return {
        text: "Provide a linkedinUrl, or firstName + lastName with a companyName or companyDomain.",
        pending: false,
      };
    }
    const started = await request(apiKey, "POST", "/v2/people/enrich", {
      include: { email: true, mobile: true },
      people: [person],
    });
    const id = started.enrichmentID ?? started.id;
    if (!id) return { text: renderLoose(started), pending: false };
    return {
      text: `Surfe started the enrichment (enrichment id ${id}). Call surfe_get_result with that id in a few seconds to read the email and mobile.`,
      pending: true,
    };
  },

  async getResult(apiKey, args) {
    if (!args.enrichmentId) return { text: "Provide the enrichmentId.", pending: false };
    const json = await request(
      apiKey,
      "GET",
      `/v2/people/enrich/${encodeURIComponent(args.enrichmentId)}`,
    );
    const done = json.status ? FINISHED.has(json.status) : !!json.people;
    if (!done) {
      return {
        text: `Surfe is still enriching this request (enrichment id ${
          json.enrichmentID ?? json.id ?? args.enrichmentId
        }, status ${json.status ?? "pending"}). Call surfe_get_result again after working on something else for a moment.`,
        pending: true,
      };
    }
    const p = json.people?.[0];
    if (!p) return { text: "_No enrichment returned._", pending: false };
    const email = firstEmail(p);
    const mobile = firstMobile(p);
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
    const headline = `**${name || "Unknown"}**${p.companyName ? ` at ${p.companyName}` : ""}`;
    const lines = [headline];
    if (email) lines.push(`Email: ${email}`);
    if (mobile) lines.push(`Mobile: ${mobile}`);
    if (!email && !mobile) return { text: renderLoose(p), pending: false };
    return { text: lines.join("\n"), pending: false };
  },
};
