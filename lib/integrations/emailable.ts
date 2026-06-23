import "server-only";
import type { ConnectorAdapter } from "./types";

// Emailable (email verification). Auth is an API key passed as the `api_key`
// query param. The single read is GET /verify, returning a deliverability
// `state` (deliverable / undeliverable / risky / unknown) plus a reason, a
// score, and a `did_you_mean` typo suggestion. validateApiKey runs a probe
// verify (smtp=false to keep it fast) and treats a 401/403 as a bad key.
const API = "https://api.emailable.com/v1";

interface VerifyResponse {
  email?: string | null;
  state?: string | null;
  reason?: string | null;
  score?: number | null;
  did_you_mean?: string | null;
  message?: string | null;
}

export interface EmailableAdapter extends ConnectorAdapter {
  verifyEmail(
    apiKey: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

async function get(
  apiKey: string,
  params: Record<string, string>,
): Promise<{ status: number; json: VerifyResponse | null }> {
  const sp = new URLSearchParams({ api_key: apiKey, ...params });
  const res = await fetch(`${API}/verify?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as VerifyResponse | null;
  return { status: res.status, json };
}

export const emailableAdapter: EmailableAdapter = {
  provider: "emailable",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const { status, json } = await get(apiKey, {
        email: "connection-check@example.com",
        smtp: "false",
      });
      if (status === 401 || status === 403) {
        return { ok: false, message: "Emailable rejected the API key (check it in your dashboard → API)." };
      }
      if (status >= 400) {
        return { ok: false, message: json?.message ?? `Emailable returned ${status}` };
      }
      return { ok: true, accountLabel: "Emailable" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async verifyEmail(apiKey, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const { status, json } = await get(apiKey, { email: args.email });
    if (status >= 400) {
      throw new Error(`Emailable error (${status}): ${json?.message ?? "request failed"}`);
    }
    const state = json?.state ?? "unknown";
    const reason = json?.reason ? ` (${json.reason})` : "";
    const suggestion = json?.did_you_mean ? ` — did you mean ${json.did_you_mean}?` : "";
    return {
      text: `${json?.email ?? args.email}: ${state}${reason}${suggestion}`,
      ok: state === "deliverable",
    };
  },
};
