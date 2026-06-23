import "server-only";
import type { ConnectorAdapter } from "./types";

// Copper (CRM built on Google Workspace, common in agency BD). Auth needs both
// an API key AND the email of the user who generated it, sent as X-PW-* headers
// — so, like Recruitee/Loxo, the stored credential is the user-pasted pair
// "email:api-key" and validateApiKey teaches the format on miss. Reads are the
// POST /search endpoints for people, companies, and opportunities (each returns
// a bare array) with page_number paging and an optional name filter. Emails and
// phones arrive as arrays of typed objects, so rendering pulls the first of each.
const API = "https://api.copper.com/developer_api/v1";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

const CREDENTIAL_HINT =
  'Paste the credential as "your-email:api-key" — create the key in Copper under Settings → Integrations → API Keys, and use the email of the user who generated it.';

interface CopperValue {
  email?: string | null;
  number?: string | null;
}
export interface CopperPerson {
  id?: number;
  name?: string | null;
  title?: string | null;
  company_name?: string | null;
  emails?: CopperValue[] | null;
  phone_numbers?: CopperValue[] | null;
}
export interface CopperCompany {
  id?: number;
  name?: string | null;
  email_domain?: string | null;
  phone_numbers?: CopperValue[] | null;
}
export interface CopperOpportunity {
  id?: number;
  name?: string | null;
  status?: string | null;
  monetary_value?: number | null;
  company_name?: string | null;
}

export interface CopperAdapter extends ConnectorAdapter {
  searchPeople(
    credential: string,
    args?: { name?: string; limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  searchCompanies(
    credential: string,
    args?: { name?: string; limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  searchOpportunities(
    credential: string,
    args?: { name?: string; limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

function parseCredential(
  credential: string,
): { email: string; key: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const email = credential.slice(0, i).trim();
  const key = credential.slice(i + 1).trim();
  if (!email || !key || !email.includes("@")) return null;
  return { email, key };
}

function headers(parsed: { email: string; key: string }): Record<string, string> {
  return {
    "X-PW-AccessToken": parsed.key,
    "X-PW-Application": "developer_api",
    "X-PW-UserEmail": parsed.email,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call<T>(
  credential: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Copper credential is malformed. ${CREDENTIAL_HINT}`);
  const init: RequestInit = { method, headers: headers(parsed) };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Copper error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function search<T>(
  credential: string,
  path: string,
  args: { name?: string; limit?: number; page?: number } | undefined,
): Promise<{ rows: T[]; limit: number }> {
  const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
  const rows = await call<T[]>(credential, "POST", path, {
    page_size: limit,
    page_number: args?.page ?? 1,
    name: args?.name,
  });
  return { rows: Array.isArray(rows) ? rows : [], limit };
}

export const copperAdapter: CopperAdapter = {
  provider: "copper",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      const account = await call<{ name?: string | null }>(credential, "GET", "/account");
      return { ok: true, accountLabel: account.name ? `Copper (${account.name})` : "Copper" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchPeople(credential, args) {
    const { rows, limit } = await search<CopperPerson>(credential, "/people/search", args);
    const lines = [
      "| Name | Email | Phone | Company | Title | Person ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const p of rows) {
      lines.push(
        `| ${cell(p.name)} | ${cell(p.emails?.[0]?.email)} | ${cell(
          p.phone_numbers?.[0]?.number,
        )} | ${cell(p.company_name)} | ${cell(p.title)} | ${cell(p.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: rows.length ? lines.join("\n") : "_No people found._",
      count: rows.length,
      truncated: truncated || rows.length >= limit,
    };
  },

  async searchCompanies(credential, args) {
    const { rows, limit } = await search<CopperCompany>(credential, "/companies/search", args);
    const lines = [
      "| Company | Email domain | Phone | Company ID |",
      "| --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of rows) {
      lines.push(
        `| ${cell(c.name)} | ${cell(c.email_domain)} | ${cell(
          c.phone_numbers?.[0]?.number,
        )} | ${cell(c.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: rows.length ? lines.join("\n") : "_No companies found._",
      count: rows.length,
      truncated: truncated || rows.length >= limit,
    };
  },

  async searchOpportunities(credential, args) {
    const { rows, limit } = await search<CopperOpportunity>(
      credential,
      "/opportunities/search",
      args,
    );
    const lines = [
      "| Opportunity | Status | Value | Company | Opportunity ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const o of rows) {
      const value = o.monetary_value != null ? String(o.monetary_value) : "";
      lines.push(
        `| ${cell(o.name)} | ${cell(o.status)} | ${cell(value)} | ${cell(
          o.company_name,
        )} | ${cell(o.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: rows.length ? lines.join("\n") : "_No opportunities found._",
      count: rows.length,
      truncated: truncated || rows.length >= limit,
    };
  },
};
