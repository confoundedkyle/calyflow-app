import "server-only";
import type { ConnectorAdapter } from "./types";

// Jobin Cloud (https://jobin.cloud) — a recruiter candidate database + LinkedIn
// outreach tool. Auth is an API key sent as the `x-api-key` header (created in
// Jobin under Workgroups → Integrations → Custom integration). REST + JSON;
// `GET /contacts` searches the candidate database with filters and paginates
// with page/limit (+ a cursor beyond page 100).
const API = "https://my.jobin.cloud/api/openapi/v1";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100; // the API caps `limit` at 100
const CHAR_CAP = 12_000;

export interface JobinLocation {
  fullAddress?: string | null;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  country?: string | null;
}

export interface JobinContact {
  id: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  workEmail?: string | null;
  privateEmail?: string | null;
  otherEmails?: string[];
  currentTitle?: string | null;
  currentCompany?: string | null;
  previousTitle?: string | null;
  previousCompany?: string | null;
  socialUrls?: string[];
  location?: JobinLocation | null;
  seniority?: string | null;
  openToWork?: boolean | null;
}

interface JobinContactsResponse {
  items?: JobinContact[];
  page?: number;
  limit?: number;
  nextCursor?: string | null;
  total?: number | null;
}

interface JobinCampaign {
  id?: string;
  name?: string | null;
  title?: string | null;
  status?: string | null;
  state?: string | null;
  contactCount?: number | null;
}

interface JobinCampaignsResponse {
  items?: JobinCampaign[];
}

export interface JobinSearchArgs {
  roleTitle?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  socialUrl?: string;
  limit?: number;
}

export interface JobinAdapter extends ConnectorAdapter {
  searchCandidates(
    apiKey: string,
    args: JobinSearchArgs,
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listCampaigns(
    apiKey: string,
  ): Promise<{ text: string; count: number }>;
}

async function get<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Jobin Cloud ${path} failed (${res.status}): ${detail.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function nameOf(c: JobinContact): string {
  return [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ").trim();
}

function emailOf(c: JobinContact): string {
  return c.workEmail ?? c.privateEmail ?? c.otherEmails?.[0] ?? "";
}

function linkedinOf(c: JobinContact): string {
  const urls = c.socialUrls ?? [];
  return urls.find((u) => /linkedin\.com/i.test(u)) ?? urls[0] ?? "";
}

function locationOf(c: JobinContact): string {
  const l = c.location;
  if (!l) return "";
  if (l.fullAddress) return l.fullAddress;
  return [l.city, l.state ?? l.region, l.country].filter(Boolean).join(", ");
}

function renderContacts(contacts: JobinContact[]): {
  text: string;
  truncated: boolean;
} {
  if (contacts.length === 0) return { text: "_No candidates._", truncated: false };
  const lines = [
    "| Name | Title | Company | Email | Location | LinkedIn |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  let truncated = false;
  for (const c of contacts) {
    lines.push(
      `| ${cell(nameOf(c))} | ${cell(c.currentTitle ?? "")} | ${cell(
        c.currentCompany ?? "",
      )} | ${cell(emailOf(c))} | ${cell(locationOf(c))} | ${cell(linkedinOf(c))} |`,
    );
    if (lines.join("\n").length > CHAR_CAP) {
      truncated = true;
      break;
    }
  }
  return { text: lines.join("\n"), truncated };
}

export const jobinAdapter: JobinAdapter = {
  provider: "jobin-cloud",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // A bad key returns 401 { valid:false }, which get() turns into a throw — so
    // call directly here to give a clean rejection message either way.
    try {
      const res = await fetch(`${API}/auth/validate`, {
        headers: { "x-api-key": apiKey, Accept: "application/json" },
      });
      const json = (await res.json().catch(() => null)) as {
        valid?: boolean;
        label?: string;
      } | null;
      if (!res.ok || json?.valid === false) {
        return {
          ok: false,
          message:
            "Jobin Cloud rejected that API key — check it's correct and active.",
        };
      }
      return { ok: true, accountLabel: json?.label || "Jobin Cloud" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchCandidates(apiKey, args) {
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<JobinContactsResponse>(apiKey, "/contacts", {
      roleTitle: args.roleTitle,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      socialUrl: args.socialUrl,
      limit,
    });
    const contacts = json.items ?? [];
    const rendered = renderContacts(contacts);
    return {
      text: rendered.text,
      count: contacts.length,
      truncated: rendered.truncated || !!json.nextCursor,
    };
  },

  async listCampaigns(apiKey) {
    const json = await get<JobinCampaignsResponse>(apiKey, "/campaigns");
    const campaigns = json.items ?? [];
    if (campaigns.length === 0) return { text: "_No campaigns._", count: 0 };
    const lines = ["| Campaign | Status | Contacts | ID |", "| --- | --- | --- | --- |"];
    for (const c of campaigns) {
      lines.push(
        `| ${cell(c.name ?? c.title ?? "")} | ${cell(
          c.status ?? c.state ?? "",
        )} | ${c.contactCount ?? ""} | ${c.id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) break;
    }
    return { text: lines.join("\n"), count: campaigns.length };
  },
};
