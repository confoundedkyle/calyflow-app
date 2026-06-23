import "server-only";
import type { ConnectorAdapter } from "./types";

// Bouncer (email verification). Auth is an API key sent as an x-api-key header.
// The single read is a synchronous GET /v1.1/email/verify returning a
// deliverability status (deliverable / undeliverable / risky / unknown) plus a
// reason. validateApiKey runs a probe verification and reads the status code —
// 401/403 means a bad key — which is robust without depending on a separate
// credits endpoint.
const API = "https://api.usebouncer.com";

function headers(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, Accept: "application/json" };
}

export interface BouncerAdapter extends ConnectorAdapter {
  verifyEmail(
    apiKey: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

export const bouncerAdapter: BouncerAdapter = {
  provider: "bouncer",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const res = await fetch(
        `${API}/v1.1/email/verify?email=${encodeURIComponent("connection-check@example.com")}`,
        { headers: headers(apiKey) },
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Bouncer rejected the API key (check it in your account → API)." };
      }
      return { ok: true, accountLabel: "Bouncer" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async verifyEmail(apiKey, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const res = await fetch(
      `${API}/v1.1/email/verify?email=${encodeURIComponent(args.email)}`,
      { headers: headers(apiKey) },
    );
    const json = (await res.json().catch(() => null)) as
      | { email?: string | null; status?: string | null; reason?: string | null; message?: string | null }
      | null;
    if (!res.ok) {
      throw new Error(`Bouncer error (${res.status}): ${json?.message ?? res.statusText}`);
    }
    const status = json?.status ?? "unknown";
    const reason = json?.reason ? ` (${json.reason})` : "";
    return {
      text: `${json?.email ?? args.email}: ${status}${reason}`,
      ok: status === "deliverable",
    };
  },
};
