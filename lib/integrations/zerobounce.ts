import "server-only";
import type { ConnectorAdapter } from "./types";

// ZeroBounce (email verification + scoring). Auth is an API key passed as the
// api_key query param. The single read is a synchronous GET /validate that
// returns a deliverability status (valid / invalid / catch-all / unknown /
// spamtrap / abuse / do_not_mail) plus a sub_status reason. validateApiKey
// reads GET /getcredits, which returns the balance as a string ("-1" on a bad
// key) — so the credit balance also labels the connection.
const API = "https://api.zerobounce.net/v2";

export interface ZerobounceAdapter extends ConnectorAdapter {
  verifyEmail(
    apiKey: string,
    args: { email: string; ipAddress?: string },
  ): Promise<{ text: string; ok: boolean }>;
}

async function get<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  sp.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, v);
  const res = await fetch(`${API}${path}?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { error?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`ZeroBounce error (${res.status}): ${detail}`);
  }
  return json as T;
}

export const zerobounceAdapter: ZerobounceAdapter = {
  provider: "zerobounce",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await get<{ Credits?: string }>(apiKey, "/getcredits");
      const credits = json.Credits;
      if (credits == null || credits === "-1") {
        return { ok: false, message: "ZeroBounce rejected the API key (check it in your account)." };
      }
      return { ok: true, accountLabel: `ZeroBounce (${credits} credits)` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async verifyEmail(apiKey, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const json = await get<{
      address?: string | null;
      status?: string | null;
      sub_status?: string | null;
    }>(apiKey, "/validate", { email: args.email, ip_address: args.ipAddress });
    const status = json.status ?? "unknown";
    const sub = json.sub_status ? ` (${json.sub_status})` : "";
    return {
      text: `${json.address ?? args.email}: ${status}${sub}`,
      ok: status === "valid",
    };
  },
};
