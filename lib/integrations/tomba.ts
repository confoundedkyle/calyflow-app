import "server-only";
import type { ConnectorAdapter } from "./types";

// Tomba (email finder + verifier). Auth is a key + secret pair sent as
// X-Tomba-Key / X-Tomba-Secret headers, so — like Recruitee/Gong — the stored
// credential is the user-pasted pair "key:secret" and validateApiKey teaches
// the format on miss. Lookups are synchronous: GET /v1/email-finder/{domain}
// finds an email from a name + company domain, and GET /v1/email-verifier/{email}
// checks deliverability. Both wrap the payload under `data`. validateApiKey runs
// a probe verify and reads the status code (401/403 = bad key).
const API = "https://api.tomba.io";

const CREDENTIAL_HINT =
  'Paste the credential as "key:secret" — both are shown in Tomba under Settings → API (the key starts with ta_, the secret with ts_).';

interface VerifyEmail {
  email?: string | null;
  status?: string | null;
  result?: string | null;
}

export interface TombaAdapter extends ConnectorAdapter {
  findEmail(
    credential: string,
    args: { firstName: string; lastName: string; domain: string },
  ): Promise<{ text: string; found: boolean }>;
  verifyEmail(
    credential: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

function parseCredential(
  credential: string,
): { key: string; secret: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const key = credential.slice(0, i).trim();
  const secret = credential.slice(i + 1).trim();
  if (!key || !secret) return null;
  return { key, secret };
}

function headers(parsed: { key: string; secret: string }): Record<string, string> {
  return {
    "X-Tomba-Key": parsed.key,
    "X-Tomba-Secret": parsed.secret,
    Accept: "application/json",
  };
}

async function rawGet(credential: string, path: string): Promise<Response> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Tomba credential is malformed. ${CREDENTIAL_HINT}`);
  return fetch(`${API}${path}`, { headers: headers(parsed) });
}

async function get<T>(credential: string, path: string): Promise<T> {
  const res = await rawGet(credential, path);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { errors?: string } | null)?.errors ??
      res.statusText;
    throw new Error(`Tomba error (${res.status}): ${detail}`);
  }
  return json as T;
}

export const tombaAdapter: TombaAdapter = {
  provider: "tomba",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      const res = await rawGet(
        credential,
        `/v1/email-verifier/${encodeURIComponent("connection-check@example.com")}`,
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Tomba rejected the credentials (check the key and secret)." };
      }
      return { ok: true, accountLabel: "Tomba" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async findEmail(credential, args) {
    if (!args.firstName || !args.lastName || !args.domain) {
      return { text: "Provide firstName, lastName, and domain.", found: false };
    }
    const sp = new URLSearchParams({ first_name: args.firstName, last_name: args.lastName });
    const json = await get<{
      data?: {
        email?: string | null;
        score?: number | null;
        position?: string | null;
        company?: string | null;
      } | null;
    }>(credential, `/v1/email-finder/${encodeURIComponent(args.domain)}?${sp.toString()}`);
    const d = json.data;
    if (!d?.email) {
      return { text: `No email found for ${args.firstName} ${args.lastName} at ${args.domain}.`, found: false };
    }
    const detail = [
      d.score != null ? `score: ${d.score}` : null,
      d.position && `title: ${d.position}`,
      d.company && `company: ${d.company}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return { text: `**${d.email}**${detail ? `\n${detail}` : ""}`, found: true };
  },

  async verifyEmail(credential, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const json = await get<{ data?: { email?: VerifyEmail | string | null; status?: string | null; result?: string | null } | null }>(
      credential,
      `/v1/email-verifier/${encodeURIComponent(args.email)}`,
    );
    const d = json.data ?? {};
    const nested = typeof d.email === "object" && d.email !== null ? d.email : null;
    const result = nested?.result ?? d.result ?? "unknown";
    const status = nested?.status ?? d.status;
    return {
      text: `${args.email}: ${result}${status ? ` (${status})` : ""}`,
      ok: result === "deliverable",
    };
  },
};
