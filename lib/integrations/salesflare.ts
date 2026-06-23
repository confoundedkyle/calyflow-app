import "server-only";
import type { ConnectorAdapter } from "./types";

// Salesflare (auto-enriched, account-centric CRM). Auth is an API key
// (Salesflare: Settings → API key) sent as a Bearer token. List endpoints
// return bare arrays with limit/offset paging; contacts can be filtered by
// name/email, and a contact links to its account (embedded name). Reads are
// contacts, accounts, and opportunities. validateApiKey reads /me.
const API = "https://api.salesflare.com";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

export interface SalesflareContact {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  account?: { name?: string | null } | null;
}

export interface SalesflareAccount {
  id?: number;
  name?: string | null;
  website?: string | null;
  phone_number?: string | null;
  email?: string | null;
}

export interface SalesflareOpportunity {
  id?: number;
  name?: string | null;
  value?: number | null;
  status?: string | null;
  account?: { name?: string | null } | null;
}

export interface SalesflareAdapter extends ConnectorAdapter {
  searchContacts(
    apiKey: string,
    args?: { name?: string; email?: string; limit?: number; offset?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listAccounts(
    apiKey: string,
    args?: { name?: string; limit?: number; offset?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listOpportunities(
    apiKey: string,
    args?: { limit?: number; offset?: number },
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
      (json as { error?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`Salesflare error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const salesflareAdapter: SalesflareAdapter = {
  provider: "salesflare",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const me = await get<{ name?: string | null; email?: string | null }>(apiKey, "/me");
      const label = me.name ?? me.email;
      return { ok: true, accountLabel: label ? `Salesflare (${label})` : "Salesflare" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchContacts(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const rows = await get<SalesflareContact[]>(apiKey, "/contacts", {
      name: args?.name,
      email: args?.email,
      limit,
      offset: args?.offset,
    });
    const contacts = Array.isArray(rows) ? rows : [];
    const lines = [
      "| Name | Email | Phone | Account | Contact ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of contacts) {
      lines.push(
        `| ${cell(c.name)} | ${cell(c.email)} | ${cell(c.phone_number)} | ${cell(
          c.account?.name,
        )} | ${cell(c.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: contacts.length ? lines.join("\n") : "_No contacts found._",
      count: contacts.length,
      truncated: truncated || contacts.length >= limit,
    };
  },

  async listAccounts(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const rows = await get<SalesflareAccount[]>(apiKey, "/accounts", {
      name: args?.name,
      limit,
      offset: args?.offset,
    });
    const accounts = Array.isArray(rows) ? rows : [];
    const lines = [
      "| Account | Website | Phone | Email | Account ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const a of accounts) {
      lines.push(
        `| ${cell(a.name)} | ${cell(a.website)} | ${cell(a.phone_number)} | ${cell(
          a.email,
        )} | ${cell(a.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: accounts.length ? lines.join("\n") : "_No accounts found._",
      count: accounts.length,
      truncated: truncated || accounts.length >= limit,
    };
  },

  async listOpportunities(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const rows = await get<SalesflareOpportunity[]>(apiKey, "/opportunities", {
      limit,
      offset: args?.offset,
    });
    const opps = Array.isArray(rows) ? rows : [];
    const lines = [
      "| Opportunity | Value | Status | Account | Opportunity ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const o of opps) {
      lines.push(
        `| ${cell(o.name)} | ${cell(o.value)} | ${cell(o.status)} | ${cell(
          o.account?.name,
        )} | ${cell(o.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: opps.length ? lines.join("\n") : "_No opportunities found._",
      count: opps.length,
      truncated: truncated || opps.length >= limit,
    };
  },
};
