import "server-only";
import type { ConnectorAdapter } from "./types";

// Aircall (cloud phone — candidate screening-call logs and contacts). Auth is
// an API ID + API token; the public API uses HTTP Basic with the id as the
// username and the token as the password, so — like Recruitee/Gong — the
// stored credential is the user-pasted pair "api-id:api-token" and
// validateApiKey teaches the format on miss. Reads are the call log
// (GET /calls) and contacts (GET /contacts); both wrap rows alongside a meta
// object whose next_page_link signals more pages. started_at is a unix epoch.
const API = "https://api.aircall.io/v1";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 50;
const CHAR_CAP = 12_000;

const CREDENTIAL_HINT =
  'Paste the credential as "api-id:api-token" — both are created in Aircall under Settings → Integrations & API → API Keys.';

export interface AircallCall {
  id?: number;
  direction?: string | null;
  status?: string | null;
  duration?: number | null;
  raw_digits?: string | null;
  started_at?: number | string | null;
}

interface AircallValue {
  value?: string | null;
}
export interface AircallContact {
  id?: number;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  phone_numbers?: AircallValue[] | null;
  emails?: AircallValue[] | null;
}

export interface AircallAdapter extends ConnectorAdapter {
  listCalls(
    credential: string,
    args?: { limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listContacts(
    credential: string,
    args?: { limit?: number; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

function parseCredential(
  credential: string,
): { id: string; token: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const id = credential.slice(0, i).trim();
  const token = credential.slice(i + 1).trim();
  if (!id || !token) return null;
  return { id, token };
}

async function get<T>(
  credential: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Aircall credential is malformed. ${CREDENTIAL_HINT}`);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const auth = Buffer.from(`${parsed.id}:${parsed.token}`).toString("base64");
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { troubleshoot?: string } | null)?.troubleshoot ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Aircall error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function when(ts: number | string | null | undefined): string {
  if (ts == null) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().slice(0, 16).replace("T", " ");
}

export const aircallAdapter: AircallAdapter = {
  provider: "aircall",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      await get<unknown>(credential, "/calls", { per_page: 1 });
      return { ok: true, accountLabel: "Aircall" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listCalls(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ calls?: AircallCall[]; meta?: { next_page_link?: string | null } }>(
      credential,
      "/calls",
      { per_page: limit, page: args?.page },
    );
    const calls = json.calls ?? [];
    const lines = [
      "| Direction | Status | Duration (s) | Number | Started | Call ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of calls) {
      lines.push(
        `| ${cell(c.direction)} | ${cell(c.status)} | ${c.duration ?? ""} | ${cell(
          c.raw_digits,
        )} | ${cell(when(c.started_at))} | ${c.id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.meta?.next_page_link;
    return {
      text: calls.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — increment page._" : ""}`
        : "_No calls._",
      count: calls.length,
      truncated: truncated || more,
    };
  },

  async listContacts(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ contacts?: AircallContact[]; meta?: { next_page_link?: string | null } }>(
      credential,
      "/contacts",
      { per_page: limit, page: args?.page },
    );
    const contacts = json.contacts ?? [];
    const lines = [
      "| Name | Company | Phone | Email | Contact ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of contacts) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
      lines.push(
        `| ${cell(name)} | ${cell(c.company_name)} | ${cell(
          c.phone_numbers?.[0]?.value,
        )} | ${cell(c.emails?.[0]?.value)} | ${c.id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.meta?.next_page_link;
    return {
      text: contacts.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — increment page._" : ""}`
        : "_No contacts._",
      count: contacts.length,
      truncated: truncated || more,
    };
  },
};
