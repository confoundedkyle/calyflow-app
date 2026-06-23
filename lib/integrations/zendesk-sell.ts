import "server-only";
import type { ConnectorAdapter } from "./types";

// Zendesk Sell (formerly Base CRM). Auth is a long-lived OAuth access token
// (Zendesk Sell: Settings → OAuth → Access Tokens) sent as a Bearer header.
// Every collection wraps its rows in { items: [{ data, meta }], meta }, so each
// row is unwrapped from its `data`. Contacts are people OR organizations
// (split by is_organization); deals are the BD pipeline. page/per_page paging.
const API = "https://api.getbase.com/v2";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

export interface SellContact {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  website?: string | null;
  organization_name?: string | null;
}

export interface SellDeal {
  id?: number;
  name?: string | null;
  value?: number | string | null;
  currency?: string | null;
  hot?: boolean;
  organization_name?: string | null;
}

interface Envelope<T> {
  items?: { data?: T }[];
  meta?: unknown;
}

export interface ZendeskSellAdapter extends ConnectorAdapter {
  searchPeople(
    token: string,
    args?: { name?: string; limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  searchCompanies(
    token: string,
    args?: { name?: string; limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listDeals(
    token: string,
    args?: { limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

async function get<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<Envelope<T>> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      (json as { errors?: { error?: { message?: string } }[] } | null)?.errors?.[0]?.error
        ?.message ??
      res.statusText;
    throw new Error(`Zendesk Sell error (${res.status}): ${detail}`);
  }
  return (json ?? {}) as Envelope<T>;
}

function rows<T>(env: Envelope<T>): T[] {
  return (env.items ?? []).map((i) => i.data).filter((d): d is T => !!d);
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const zendeskSellAdapter: ZendeskSellAdapter = {
  provider: "zendesk-sell",
  authType: "apikey",

  async validateApiKey(token) {
    try {
      const json = await get<{ name?: string | null; email?: string | null }>(
        token,
        "/users/self",
      );
      // /users/self returns a single { data } envelope, not items.
      const self = (json as { data?: { name?: string | null; email?: string | null } }).data;
      const label = self?.name ?? self?.email;
      return { ok: true, accountLabel: label ? `Zendesk Sell (${label})` : "Zendesk Sell" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchPeople(token, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const env = await get<SellContact>(token, "/contacts", {
      is_organization: false,
      name: args?.name,
      per_page: limit,
      page: args?.page,
    });
    const people = rows(env);
    const lines = [
      "| Name | Email | Phone | Company | Title | Contact ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const p of people) {
      lines.push(
        `| ${cell(p.name)} | ${cell(p.email)} | ${cell(p.phone)} | ${cell(
          p.organization_name,
        )} | ${cell(p.title)} | ${cell(p.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: people.length ? lines.join("\n") : "_No people found._",
      count: people.length,
      truncated: truncated || people.length >= limit,
    };
  },

  async searchCompanies(token, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const env = await get<SellContact>(token, "/contacts", {
      is_organization: true,
      name: args?.name,
      per_page: limit,
      page: args?.page,
    });
    const companies = rows(env);
    const lines = [
      "| Company | Email | Phone | Website | Contact ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of companies) {
      lines.push(
        `| ${cell(c.name)} | ${cell(c.email)} | ${cell(c.phone)} | ${cell(
          c.website,
        )} | ${cell(c.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: companies.length ? lines.join("\n") : "_No companies found._",
      count: companies.length,
      truncated: truncated || companies.length >= limit,
    };
  },

  async listDeals(token, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const env = await get<SellDeal>(token, "/deals", {
      per_page: limit,
      page: args?.page,
    });
    const deals = rows(env);
    const lines = [
      "| Deal | Value | Hot | Company | Deal ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const d of deals) {
      const value =
        d.value != null ? `${d.value}${d.currency ? ` ${d.currency}` : ""}` : "";
      lines.push(
        `| ${cell(d.name)} | ${cell(value)} | ${d.hot ? "yes" : "no"} | ${cell(
          d.organization_name,
        )} | ${cell(d.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: deals.length ? lines.join("\n") : "_No deals found._",
      count: deals.length,
      truncated: truncated || deals.length >= limit,
    };
  },
};
