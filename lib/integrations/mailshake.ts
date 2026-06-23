import "server-only";
import type { ConnectorAdapter } from "./types";

// Mailshake (cold-email outreach). Auth is an API key (Mailshake: Extensions →
// API) sent via HTTP Basic with the key as the username and an empty password —
// same scheme as Ashby/Close. Reads are the campaign list and a campaign's
// recipients; list endpoints share a { results, nextToken } envelope with
// nextToken cursor paging. validateApiKey reads /me (which returns { user }).
const API = "https://api.mailshake.com/2017-04-01";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

export interface MailshakeCampaign {
  id?: number;
  title?: string | null;
  created?: string | null;
  archived?: string | null;
}

export interface MailshakeRecipient {
  id?: number;
  emailAddress?: string | null;
  fullName?: string | null;
  created?: string | null;
}

interface Paged<T> {
  results?: T[];
  nextToken?: string | null;
}

export interface MailshakeAdapter extends ConnectorAdapter {
  listCampaigns(
    apiKey: string,
    args?: { search?: string; limit?: number; nextToken?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listRecipients(
    apiKey: string,
    args: { campaignId: number; search?: string; limit?: number; nextToken?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

function authHeader(apiKey: string): string {
  // Key as username, empty password.
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
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
      (json as { error?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`Mailshake error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const mailshakeAdapter: MailshakeAdapter = {
  provider: "mailshake",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await get<{ user?: { fullName?: string | null; emailAddress?: string | null } }>(
        apiKey,
        "/me",
      );
      const label = json.user?.fullName ?? json.user?.emailAddress;
      return { ok: true, accountLabel: label ? `Mailshake (${label})` : "Mailshake" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listCampaigns(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<Paged<MailshakeCampaign>>(apiKey, "/campaigns/list", {
      search: args?.search,
      perPage: limit,
      nextToken: args?.nextToken,
    });
    const campaigns = json.results ?? [];
    const lines = [
      "| Campaign | Created | Archived | Campaign ID |",
      "| --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of campaigns) {
      lines.push(
        `| ${cell(c.title)} | ${cell((c.created ?? "").slice(0, 10))} | ${
          c.archived ? "yes" : "no"
        } | ${c.id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const next = json.nextToken;
    return {
      text: campaigns.length
        ? `${lines.join("\n")}${next ? `\n\n_More available — pass nextToken: ${next}_` : ""}`
        : "_No campaigns._",
      count: campaigns.length,
      truncated: truncated || !!next,
    };
  },

  async listRecipients(apiKey, args) {
    if (!args.campaignId) {
      return {
        text: "Provide a campaignId (from mailshake_list_campaigns).",
        count: 0,
        truncated: false,
      };
    }
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<Paged<MailshakeRecipient>>(apiKey, "/recipients/list", {
      campaignID: args.campaignId,
      search: args.search,
      perPage: limit,
      nextToken: args.nextToken,
    });
    const recipients = json.results ?? [];
    const lines = [
      "| Name | Email | Added | Recipient ID |",
      "| --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const r of recipients) {
      lines.push(
        `| ${cell(r.fullName)} | ${cell(r.emailAddress)} | ${cell(
          (r.created ?? "").slice(0, 10),
        )} | ${r.id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const next = json.nextToken;
    return {
      text: recipients.length
        ? `${lines.join("\n")}${next ? `\n\n_More available — pass nextToken: ${next}_` : ""}`
        : "_No recipients in that campaign._",
      count: recipients.length,
      truncated: truncated || !!next,
    };
  },
};
