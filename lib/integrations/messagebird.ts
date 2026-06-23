import "server-only";
import type { ConnectorAdapter } from "./types";

// MessageBird / Bird (SMS messaging). Auth is an access key sent as an
// `Authorization: AccessKey <key>` header. The single read is the message
// history (GET /messages), which wraps rows in an items array alongside
// pagination counts. Direction is mt (outbound) / mo (inbound), and the
// counterpart number lives under recipients.items[0].recipient. validateApiKey
// reads /balance and labels the connection with it.
const API = "https://rest.messagebird.com";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 50;
const CHAR_CAP = 12_000;

interface MbRecipient {
  recipient?: number | string | null;
}
export interface MbMessage {
  id?: string | null;
  direction?: string | null;
  originator?: string | null;
  body?: string | null;
  createdDatetime?: string | null;
  recipients?: { items?: MbRecipient[] | null } | null;
}
interface MbError {
  errors?: { description?: string }[] | null;
}

export interface MessagebirdAdapter extends ConnectorAdapter {
  listMessages(
    apiKey: string,
    args?: { limit?: number; offset?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
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
    headers: { Authorization: `AccessKey ${apiKey}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as MbError | null)?.errors?.[0]?.description ?? res.statusText;
    throw new Error(`MessageBird error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function direction(d: string | null | undefined): string {
  if (d === "mt") return "outbound";
  if (d === "mo") return "inbound";
  return d ?? "";
}

export const messagebirdAdapter: MessagebirdAdapter = {
  provider: "messagebird",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const balance = await get<{ amount?: number; type?: string }>(apiKey, "/balance");
      const label =
        balance.amount != null
          ? `MessageBird (${balance.amount} ${balance.type ?? "balance"})`
          : "MessageBird";
      return { ok: true, accountLabel: label };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listMessages(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{ items?: MbMessage[]; totalCount?: number; offset?: number }>(
      apiKey,
      "/messages",
      { limit, offset: args?.offset },
    );
    const items = json.items ?? [];
    const lines = [
      "| Direction | From | To | Body | Sent |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const m of items) {
      const to = m.recipients?.items?.[0]?.recipient ?? "";
      const sent = m.createdDatetime ? cell(m.createdDatetime).slice(0, 16) : "";
      lines.push(
        `| ${direction(m.direction)} | ${cell(m.originator)} | ${cell(to)} | ${cell(
          m.body,
        ).slice(0, 120)} | ${sent} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more =
      json.totalCount != null && (args?.offset ?? 0) + items.length < json.totalCount;
    return {
      text: items.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — increase offset._" : ""}`
        : "_No messages._",
      count: items.length,
      truncated: truncated || more,
    };
  },
};
