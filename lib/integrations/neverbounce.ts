import "server-only";
import type { ConnectorAdapter } from "./types";

// NeverBounce (email verification). Auth is an API key passed as the `key`
// query param. The API returns HTTP 200 even on failures, signalling the
// outcome via a top-level `status` field ("success" vs "auth_failure" /
// "general_failure"), so the request helper checks that field too. The single
// read is GET /single/check, returning a result (valid / invalid / disposable /
// catchall / unknown). validateApiKey reads /account/info and labels the
// connection with the remaining credits.
const API = "https://api.neverbounce.com/v4";

interface NbResponse {
  status?: string | null;
  result?: string | null;
  message?: string | null;
  credits_info?: { paid_credits_remaining?: number; free_credits_remaining?: number } | null;
}

export interface NeverbounceAdapter extends ConnectorAdapter {
  verifyEmail(
    apiKey: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

async function get(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<NbResponse> {
  const sp = new URLSearchParams();
  sp.set("key", apiKey);
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, v);
  const res = await fetch(`${API}${path}?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as NbResponse | null;
  if (!res.ok) {
    throw new Error(`NeverBounce error (${res.status}): ${json?.message ?? res.statusText}`);
  }
  // NeverBounce signals logical errors (auth_failure, general_failure) in the body.
  if (json?.status && json.status !== "success") {
    throw new Error(`NeverBounce error: ${json.message ?? json.status}`);
  }
  return json ?? {};
}

export const neverbounceAdapter: NeverbounceAdapter = {
  provider: "neverbounce",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await get(apiKey, "/account/info");
      const credits = json.credits_info?.paid_credits_remaining;
      return {
        ok: true,
        accountLabel:
          typeof credits === "number"
            ? `NeverBounce (${credits} credits)`
            : "NeverBounce",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async verifyEmail(apiKey, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const json = await get(apiKey, "/single/check", { email: args.email });
    const result = json.result ?? "unknown";
    return {
      text: `${args.email}: ${result}`,
      ok: result === "valid",
    };
  },
};
