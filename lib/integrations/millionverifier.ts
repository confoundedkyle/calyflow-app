import "server-only";
import type { ConnectorAdapter } from "./types";

// MillionVerifier (email verification). Auth is an API key passed as the `api`
// query param. Like NeverBounce the API answers HTTP 200 and signals key/quota
// problems via a top-level `error` field, so the request helper checks that
// too. The single read is GET /api/v3/ returning a `result` (ok / catch_all /
// unknown / error / disposable / invalid). validateApiKey runs a probe verify
// and labels the connection with the remaining credits.
const API = "https://api.millionverifier.com/api/v3";

interface MvResponse {
  email?: string | null;
  result?: string | null;
  quality?: string | null;
  credits?: number | null;
  error?: string | null;
}

export interface MillionverifierAdapter extends ConnectorAdapter {
  verifyEmail(
    apiKey: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

async function get(apiKey: string, email: string): Promise<MvResponse> {
  const sp = new URLSearchParams({ api: apiKey, email });
  const res = await fetch(`${API}/?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as MvResponse | null;
  if (!res.ok) {
    throw new Error(`MillionVerifier error (${res.status}): ${json?.error ?? res.statusText}`);
  }
  // MillionVerifier reports key/quota problems in the body with HTTP 200.
  if (json?.error) {
    throw new Error(`MillionVerifier error: ${json.error}`);
  }
  return json ?? {};
}

export const millionverifierAdapter: MillionverifierAdapter = {
  provider: "millionverifier",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await get(apiKey, "connection-check@example.com");
      return {
        ok: true,
        accountLabel:
          typeof json.credits === "number"
            ? `MillionVerifier (${json.credits} credits)`
            : "MillionVerifier",
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
    const json = await get(apiKey, args.email);
    const result = json.result ?? "unknown";
    const quality = json.quality ? ` (${json.quality})` : "";
    return {
      text: `${json.email ?? args.email}: ${result}${quality}`,
      ok: result === "ok",
    };
  },
};
