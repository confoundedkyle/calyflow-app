import "server-only";
import type { ConnectorAdapter } from "./types";

// Twilio (SMS / calls — candidate texting and screening-call logs). Auth is the
// Account SID + Auth Token; the SID sits in both the URL path and the HTTP Basic
// username, so — like Recruitee/Gong — the stored credential is the user-pasted
// pair "account-sid:auth-token" and validateApiKey teaches the format on miss.
// Reads are the message log (GET /Messages.json) and the call log
// (GET /Calls.json), both filterable by To/From with PageSize paging.
const API = "https://api.twilio.com/2010-04-01";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;
const BODY_CAP = 120;

const CREDENTIAL_HINT =
  'Paste the credential as "account-sid:auth-token" — both are on your Twilio Console dashboard (the Account SID starts with AC).';

export interface TwilioMessage {
  sid?: string;
  from?: string | null;
  to?: string | null;
  body?: string | null;
  status?: string | null;
  direction?: string | null;
  date_sent?: string | null;
}

export interface TwilioCall {
  sid?: string;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  direction?: string | null;
  duration?: string | null;
  start_time?: string | null;
}

export interface TwilioAdapter extends ConnectorAdapter {
  listMessages(
    credential: string,
    args?: { to?: string; from?: string; limit?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listCalls(
    credential: string,
    args?: { to?: string; from?: string; limit?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

function parseCredential(
  credential: string,
): { sid: string; token: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const sid = credential.slice(0, i).trim();
  const token = credential.slice(i + 1).trim();
  if (!sid || !token) return null;
  return { sid, token };
}

async function get<T>(
  credential: string,
  suffix: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Twilio credential is malformed. ${CREDENTIAL_HINT}`);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const auth = Buffer.from(`${parsed.sid}:${parsed.token}`).toString("base64");
  const res = await fetch(
    `${API}/Accounts/${encodeURIComponent(parsed.sid)}${suffix}${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { message?: string } | null)?.message ?? res.statusText;
    throw new Error(`Twilio error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function clip(s: string | null | undefined): string {
  if (!s) return "";
  return s.length > BODY_CAP ? `${s.slice(0, BODY_CAP)}…` : s;
}

export const twilioAdapter: TwilioAdapter = {
  provider: "twilio",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      const account = await get<{ friendly_name?: string | null }>(credential, ".json");
      return {
        ok: true,
        accountLabel: account.friendly_name ? `Twilio (${account.friendly_name})` : "Twilio",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listMessages(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ messages?: TwilioMessage[]; next_page_uri?: string | null }>(
      credential,
      "/Messages.json",
      { PageSize: limit, To: args?.to, From: args?.from },
    );
    const messages = json.messages ?? [];
    const lines = [
      "| From | To | Direction | Status | Message | Sent |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const m of messages) {
      lines.push(
        `| ${cell(m.from)} | ${cell(m.to)} | ${cell(m.direction)} | ${cell(
          m.status,
        )} | ${cell(clip(m.body))} | ${cell((m.date_sent ?? "").slice(0, 16))} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.next_page_uri;
    return {
      text: messages.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — narrow with To/From._" : ""}`
        : "_No messages._",
      count: messages.length,
      truncated: truncated || more,
    };
  },

  async listCalls(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ calls?: TwilioCall[]; next_page_uri?: string | null }>(
      credential,
      "/Calls.json",
      { PageSize: limit, To: args?.to, From: args?.from },
    );
    const calls = json.calls ?? [];
    const lines = [
      "| From | To | Direction | Status | Duration (s) | Started |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of calls) {
      lines.push(
        `| ${cell(c.from)} | ${cell(c.to)} | ${cell(c.direction)} | ${cell(
          c.status,
        )} | ${cell(c.duration)} | ${cell((c.start_time ?? "").slice(0, 16))} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.next_page_uri;
    return {
      text: calls.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — narrow with To/From._" : ""}`
        : "_No calls._",
      count: calls.length,
      truncated: truncated || more,
    };
  },
};
