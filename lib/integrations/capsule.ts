import "server-only";
import type { ConnectorAdapter } from "./types";

// Capsule (lightweight CRM popular with small agencies). Auth is a Personal
// Access Token (Capsule: My Preferences → API Authentication Tokens) sent as a
// Bearer header. Parties are people OR organisations in one collection — a
// person carries firstName/lastName plus a linked organisation (embedded for
// its name), an organisation carries its own name. Reads are parties
// (GET /parties, or /parties/search?q= when a query is given) and opportunities
// (GET /opportunities). page/perPage paging.
const API = "https://api.capsulecrm.com/api/v2";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

interface CapsuleValue {
  address?: string | null;
  number?: string | null;
}
export interface CapsuleParty {
  id?: number;
  type?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  organisation?: { name?: string | null } | null;
  emailAddresses?: CapsuleValue[] | null;
  phoneNumbers?: CapsuleValue[] | null;
}

export interface CapsuleOpportunity {
  id?: number;
  name?: string | null;
  value?: { amount?: number | null; currency?: string | null } | null;
  milestone?: { name?: string | null } | null;
  party?: { name?: string | null; firstName?: string | null; lastName?: string | null } | null;
}

export interface CapsuleAdapter extends ConnectorAdapter {
  searchParties(
    token: string,
    args?: { query?: string; limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listOpportunities(
    token: string,
    args?: { limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

async function get<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
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
      (json as { message?: string } | null)?.message ??
      (json as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message ??
      res.statusText;
    throw new Error(`Capsule error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function partyName(p: CapsuleParty): string {
  return p.name ?? [p.firstName, p.lastName].filter(Boolean).join(" ");
}

export const capsuleAdapter: CapsuleAdapter = {
  provider: "capsule",
  authType: "apikey",

  async validateApiKey(token) {
    try {
      const json = await get<{ user?: { name?: string | null; username?: string | null } }>(
        token,
        "/users/me",
      );
      const label = json.user?.name ?? json.user?.username;
      return { ok: true, accountLabel: label ? `Capsule (${label})` : "Capsule" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchParties(token, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = args?.query
      ? await get<{ parties?: CapsuleParty[] }>(token, "/parties/search", {
          q: args.query,
          perPage: limit,
          page: args?.page,
        })
      : await get<{ parties?: CapsuleParty[] }>(token, "/parties", {
          perPage: limit,
          page: args?.page,
          embed: "organisation",
        });
    const parties = json.parties ?? [];
    const lines = [
      "| Name | Type | Email | Phone | Company / Title | Party ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const p of parties) {
      const companyTitle =
        p.type === "organisation"
          ? ""
          : [p.organisation?.name, p.jobTitle].filter(Boolean).join(" — ");
      lines.push(
        `| ${cell(partyName(p))} | ${cell(p.type)} | ${cell(
          p.emailAddresses?.[0]?.address,
        )} | ${cell(p.phoneNumbers?.[0]?.number)} | ${cell(companyTitle)} | ${cell(
          p.id,
        )} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: parties.length ? lines.join("\n") : "_No parties found._",
      count: parties.length,
      truncated: truncated || parties.length >= limit,
    };
  },

  async listOpportunities(token, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ opportunities?: CapsuleOpportunity[] }>(
      token,
      "/opportunities",
      { perPage: limit, page: args?.page, embed: "party" },
    );
    const opps = json.opportunities ?? [];
    const lines = [
      "| Opportunity | Value | Milestone | Party | Opportunity ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const o of opps) {
      const value =
        o.value?.amount != null
          ? `${o.value.amount}${o.value.currency ? ` ${o.value.currency}` : ""}`
          : "";
      const party =
        o.party?.name ?? [o.party?.firstName, o.party?.lastName].filter(Boolean).join(" ");
      lines.push(
        `| ${cell(o.name)} | ${cell(value)} | ${cell(o.milestone?.name)} | ${cell(
          party,
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
