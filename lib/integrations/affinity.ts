import "server-only";
import type { ConnectorAdapter } from "./types";

// Affinity (relationship-intelligence CRM, popular with exec search / PE / VC).
// Auth is an API key (Affinity: Settings → API) sent via HTTP Basic with the
// key as the password and an empty username. Reads are persons, organizations,
// and opportunities — each a { <collection>, next_page_token } envelope with
// page_token cursor paging, and persons/organizations support a `term` search.
// Persons carry organization_ids (not names), so the people view shows the
// email and id; pair with affinity_search_organizations to resolve accounts.
// Validation lists one person to avoid guessing the whoami path.
const API = "https://api.affinity.co";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

export interface AffinityPerson {
  id?: number;
  first_name?: string | null;
  last_name?: string | null;
  primary_email?: string | null;
  emails?: string[] | null;
}

export interface AffinityOrganization {
  id?: number;
  name?: string | null;
  domain?: string | null;
}

export interface AffinityOpportunity {
  id?: number;
  name?: string | null;
}

export interface AffinityAdapter extends ConnectorAdapter {
  searchPersons(
    apiKey: string,
    args?: { query?: string; limit?: number; pageToken?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  searchOrganizations(
    apiKey: string,
    args?: { query?: string; limit?: number; pageToken?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listOpportunities(
    apiKey: string,
    args?: { query?: string; limit?: number; pageToken?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

function authHeader(apiKey: string): string {
  // Key as password, empty username.
  return `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
}

async function get<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: authHeader(apiKey), Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Affinity error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const affinityAdapter: AffinityAdapter = {
  provider: "affinity",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      await get<unknown>(apiKey, "/persons", { page_size: 1 });
      return { ok: true, accountLabel: "Affinity" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchPersons(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ persons?: AffinityPerson[]; next_page_token?: string | null }>(
      apiKey,
      "/persons",
      { term: args?.query, page_size: limit, page_token: args?.pageToken },
    );
    const persons = json.persons ?? [];
    const lines = ["| Name | Email | Person ID |", "| --- | --- | --- |"];
    let truncated = false;
    for (const p of persons) {
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
      lines.push(
        `| ${cell(name)} | ${cell(p.primary_email ?? p.emails?.[0])} | ${cell(p.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const next = json.next_page_token;
    return {
      text: persons.length
        ? `${lines.join("\n")}${next ? `\n\n_More available — pass pageToken: ${next}_` : ""}`
        : "_No persons found._",
      count: persons.length,
      truncated: truncated || !!next,
    };
  },

  async searchOrganizations(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{
      organizations?: AffinityOrganization[];
      next_page_token?: string | null;
    }>(apiKey, "/organizations", {
      term: args?.query,
      page_size: limit,
      page_token: args?.pageToken,
    });
    const orgs = json.organizations ?? [];
    const lines = ["| Organization | Domain | Organization ID |", "| --- | --- | --- |"];
    let truncated = false;
    for (const o of orgs) {
      lines.push(`| ${cell(o.name)} | ${cell(o.domain)} | ${cell(o.id)} |`);
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const next = json.next_page_token;
    return {
      text: orgs.length
        ? `${lines.join("\n")}${next ? `\n\n_More available — pass pageToken: ${next}_` : ""}`
        : "_No organizations found._",
      count: orgs.length,
      truncated: truncated || !!next,
    };
  },

  async listOpportunities(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{
      opportunities?: AffinityOpportunity[];
      next_page_token?: string | null;
    }>(apiKey, "/opportunities", {
      term: args?.query,
      page_size: limit,
      page_token: args?.pageToken,
    });
    const opps = json.opportunities ?? [];
    const lines = ["| Opportunity | Opportunity ID |", "| --- | --- |"];
    let truncated = false;
    for (const o of opps) {
      lines.push(`| ${cell(o.name)} | ${cell(o.id)} |`);
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const next = json.next_page_token;
    return {
      text: opps.length
        ? `${lines.join("\n")}${next ? `\n\n_More available — pass pageToken: ${next}_` : ""}`
        : "_No opportunities found._",
      count: opps.length,
      truncated: truncated || !!next,
    };
  },
};
