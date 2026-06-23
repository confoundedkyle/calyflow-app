import "server-only";
import type { ConnectorAdapter } from "./types";

// folk (relationship-first CRM popular with agencies and consultancies). Auth
// is an API key (folk: Settings → Workspace → API) sent as a Bearer token.
// Reads are people and companies, both wrapped in { data: { items, pagination:
// { nextLink } } } with cursor paging — nextLink is a full URL, so we extract
// its `cursor` query param to hand back for the next page. Multi-valued fields
// (emails, phones) arrive as arrays of strings or {value}-style objects, so
// rendering pulls the first of each tolerantly. There's no documented account
// endpoint, so validateApiKey lists one person to confirm the key works.
const API = "https://api.folk.app/v1";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

interface FolkValue {
  email?: string | null;
  value?: string | null;
  number?: string | null;
}

export interface FolkPerson {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  jobTitle?: string | null;
  emails?: (string | FolkValue)[] | null;
  phones?: (string | FolkValue)[] | null;
  companies?: { id?: string; name?: string | null }[] | null;
}

export interface FolkCompany {
  id?: string;
  name?: string | null;
  description?: string | null;
  emails?: (string | FolkValue)[] | null;
  urls?: (string | FolkValue)[] | null;
}

interface Paged<T> {
  data?: { items?: T[]; pagination?: { nextLink?: string | null } | null } | null;
}

export interface FolkAdapter extends ConnectorAdapter {
  listPeople(
    apiKey: string,
    args?: { limit?: number; cursor?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listCompanies(
    apiKey: string,
    args?: { limit?: number; cursor?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
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
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { error?: { message?: string } } | null)?.error?.message ??
      res.statusText;
    throw new Error(`folk error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function firstValue(
  values: (string | FolkValue)[] | null | undefined,
): string {
  const v = values?.[0];
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.email ?? v.value ?? v.number ?? "";
}

/** The next-page cursor lives inside the nextLink URL's query string. */
function cursorFrom(nextLink: string | null | undefined): string | null {
  if (!nextLink) return null;
  try {
    return new URL(nextLink).searchParams.get("cursor");
  } catch {
    return null;
  }
}

export const folkAdapter: FolkAdapter = {
  provider: "folk",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      await get<unknown>(apiKey, "/people", { limit: 1 });
      return { ok: true, accountLabel: "folk" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listPeople(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<Paged<FolkPerson>>(apiKey, "/people", {
      limit,
      cursor: args?.cursor,
    });
    const people = json.data?.items ?? [];
    const lines = [
      "| Name | Email | Phone | Title | Company | Person ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const p of people) {
      const name = p.fullName ?? [p.firstName, p.lastName].filter(Boolean).join(" ");
      const company = (p.companies ?? []).map((c) => c.name).filter(Boolean).join("; ");
      lines.push(
        `| ${cell(name)} | ${cell(firstValue(p.emails))} | ${cell(
          firstValue(p.phones),
        )} | ${cell(p.jobTitle)} | ${cell(company)} | ${cell(p.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const nextCursor = cursorFrom(json.data?.pagination?.nextLink);
    return {
      text: people.length
        ? `${lines.join("\n")}${nextCursor ? `\n\n_More available — pass cursor: ${nextCursor}_` : ""}`
        : "_No people found._",
      count: people.length,
      truncated: truncated || !!nextCursor,
    };
  },

  async listCompanies(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<Paged<FolkCompany>>(apiKey, "/companies", {
      limit,
      cursor: args?.cursor,
    });
    const companies = json.data?.items ?? [];
    const lines = [
      "| Company | Email | Website | Company ID |",
      "| --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of companies) {
      lines.push(
        `| ${cell(c.name)} | ${cell(firstValue(c.emails))} | ${cell(
          firstValue(c.urls),
        )} | ${cell(c.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const nextCursor = cursorFrom(json.data?.pagination?.nextLink);
    return {
      text: companies.length
        ? `${lines.join("\n")}${nextCursor ? `\n\n_More available — pass cursor: ${nextCursor}_` : ""}`
        : "_No companies found._",
      count: companies.length,
      truncated: truncated || !!nextCursor,
    };
  },
};
