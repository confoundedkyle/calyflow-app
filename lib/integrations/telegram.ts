import "server-only";
import type { ConnectorAdapter } from "./types";

// Telegram (bot — read recent messages sent to the bot or its groups, e.g. a
// candidate community). Auth is a bot token, which Telegram takes in the URL
// path (/bot{token}/method). Reads are getUpdates (recent updates). Telegram
// answers HTTP 200 with an { ok, result, description } envelope, so the helper
// checks `ok` too. validateApiKey calls getMe and labels with the bot username.
const API = "https://api.telegram.org";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

interface TgUser {
  username?: string | null;
  first_name?: string | null;
}
interface TgChat {
  id?: number | null;
  title?: string | null;
  username?: string | null;
}
interface TgMessage {
  text?: string | null;
  caption?: string | null;
  date?: number | null;
  from?: TgUser | null;
  chat?: TgChat | null;
}
interface TgUpdate {
  message?: TgMessage | null;
  edited_message?: TgMessage | null;
  channel_post?: TgMessage | null;
}
interface TgResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string | null;
}

export interface TelegramAdapter extends ConnectorAdapter {
  getUpdates(
    token: string,
    args?: { limit?: number },
  ): Promise<{ text: string; count: number }>;
}

async function call<T>(
  token: string,
  method: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}/bot${token}/${method}${qs ? `?${qs}` : ""}`, {
    headers: { Accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as TgResponse<T> | null;
  if (!res.ok || !json?.ok) {
    const detail = json?.description ?? res.statusText;
    throw new Error(`Telegram error (${res.status}): ${detail}`);
  }
  return json.result as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function when(ts: number | null | undefined): string {
  if (ts == null) return "";
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().slice(0, 16).replace("T", " ");
}

export const telegramAdapter: TelegramAdapter = {
  provider: "telegram",
  authType: "apikey",

  async validateApiKey(token) {
    try {
      const me = await call<TgUser>(token, "getMe");
      const name = me.username ?? me.first_name;
      return { ok: true, accountLabel: name ? `Telegram (@${me.username ?? name})` : "Telegram" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async getUpdates(token, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const updates = await call<TgUpdate[]>(token, "getUpdates", { limit });
    const list = updates ?? [];
    const lines = [
      "| From | Message | Chat | Sent |",
      "| --- | --- | --- | --- |",
    ];
    let rows = 0;
    for (const u of list) {
      const m = u.message ?? u.edited_message ?? u.channel_post;
      if (!m) continue;
      const from = m.from?.username ? `@${m.from.username}` : (m.from?.first_name ?? "");
      const chat = m.chat?.title ?? (m.chat?.username ? `@${m.chat.username}` : m.chat?.id ?? "");
      const body = m.text ?? m.caption ?? "";
      lines.push(`| ${cell(from)} | ${cell(body).slice(0, 160)} | ${cell(chat)} | ${cell(when(m.date))} |`);
      rows += 1;
      if (lines.join("\n").length > CHAR_CAP) break;
    }
    return {
      text: rows ? lines.join("\n") : "_No recent messages._",
      count: rows,
    };
  },
};
