import "server-only";
import type { ConnectorAdapter } from "./types";

// Stack Exchange (developer sourcing from Stack Overflow & sibling sites). Auth
// is an app key (register at stackapps.com) passed as the `key` query param,
// which raises the per-day quota. Reads: search users by name (GET /users,
// sorted by reputation) and the top answerers for a skill tag
// (GET /tags/{tag}/top-answerers/{period}) — the latter surfaces strong devs
// per technology. Responses share the { items, has_more, quota_remaining }
// envelope; errors come back with an error_message and HTTP 400.
const API = "https://api.stackexchange.com/2.3";
const DEFAULT_SITE = "stackoverflow";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

interface SeUser {
  user_id?: number;
  display_name?: string | null;
  reputation?: number | null;
  location?: string | null;
  link?: string | null;
}
interface TopAnswerer {
  post_count?: number | null;
  score?: number | null;
  user?: SeUser | null;
}

export interface StackExchangeAdapter extends ConnectorAdapter {
  searchUsers(
    apiKey: string,
    args: { name: string; site?: string; limit?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  topAnswerers(
    apiKey: string,
    args: { tag: string; site?: string; period?: string; limit?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

async function get<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  sp.set("key", apiKey);
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const res = await fetch(`${API}${path}?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json as { error_message?: string } | null)?.error_message) {
    const detail =
      (json as { error_message?: string } | null)?.error_message ?? res.statusText;
    throw new Error(`Stack Exchange error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const stackexchangeAdapter: StackExchangeAdapter = {
  provider: "stackexchange",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await get<{ quota_remaining?: number }>(apiKey, "/info", {
        site: DEFAULT_SITE,
      });
      return {
        ok: true,
        accountLabel:
          json.quota_remaining != null
            ? `Stack Exchange (${json.quota_remaining} calls left today)`
            : "Stack Exchange",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchUsers(apiKey, args) {
    if (!args.name) {
      return { text: "Provide a name to search for.", count: 0, truncated: false };
    }
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ items?: SeUser[]; has_more?: boolean }>(apiKey, "/users", {
      site: args.site ?? DEFAULT_SITE,
      inname: args.name,
      sort: "reputation",
      order: "desc",
      pagesize: limit,
    });
    const users = json.items ?? [];
    const lines = [
      "| Name | Reputation | Location | Profile | User ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const u of users) {
      lines.push(
        `| ${cell(u.display_name)} | ${u.reputation ?? ""} | ${cell(
          u.location,
        )} | ${cell(u.link)} | ${u.user_id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: users.length ? lines.join("\n") : "_No users found._",
      count: users.length,
      truncated: truncated || json.has_more === true,
    };
  },

  async topAnswerers(apiKey, args) {
    if (!args.tag) {
      return { text: "Provide a tag (e.g. python).", count: 0, truncated: false };
    }
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const period = args.period === "month" ? "month" : "all_time";
    const json = await get<{ items?: TopAnswerer[]; has_more?: boolean }>(
      apiKey,
      `/tags/${encodeURIComponent(args.tag)}/top-answerers/${period}`,
      { site: args.site ?? DEFAULT_SITE, pagesize: limit },
    );
    const answerers = json.items ?? [];
    const lines = [
      "| Name | Reputation | Answers | Score | Profile | User ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const a of answerers) {
      const u = a.user;
      lines.push(
        `| ${cell(u?.display_name)} | ${u?.reputation ?? ""} | ${
          a.post_count ?? ""
        } | ${a.score ?? ""} | ${cell(u?.link)} | ${u?.user_id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: answerers.length
        ? `_Top ${period.replace("_", " ")} answerers for "${args.tag}"._\n\n${lines.join("\n")}`
        : `_No answerers found for "${args.tag}"._`,
      count: answerers.length,
      truncated: truncated || json.has_more === true,
    };
  },
};
