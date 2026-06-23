import "server-only";
import type { ConnectorAdapter } from "./types";

// Discord (community chat — read a server's channels and message history, e.g.
// a talent community). Auth is a bot token sent as `Authorization: Bot <token>`.
// Reads are the channels of a guild (GET /guilds/{id}/channels) and the recent
// messages of a channel (GET /channels/{id}/messages). validateApiKey reads the
// bot's own user (GET /users/@me) and labels the connection with it.
const API = "https://discord.com/api/v10";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 50;
const CHAR_CAP = 12_000;

const CHANNEL_TYPES: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  10: "announcement thread",
  11: "public thread",
  12: "private thread",
  13: "stage",
  15: "forum",
};

interface DiscordChannel {
  id?: string | null;
  name?: string | null;
  type?: number | null;
}
interface DiscordMessage {
  id?: string | null;
  content?: string | null;
  timestamp?: string | null;
  author?: { username?: string | null; global_name?: string | null } | null;
}

export interface DiscordAdapter extends ConnectorAdapter {
  listChannels(
    token: string,
    args: { guildId: string },
  ): Promise<{ text: string; count: number }>;
  listMessages(
    token: string,
    args: { channelId: string; limit?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

async function get<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bot ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { message?: string } | null)?.message ?? res.statusText;
    throw new Error(`Discord error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const discordAdapter: DiscordAdapter = {
  provider: "discord",
  authType: "apikey",

  async validateApiKey(token) {
    try {
      const me = await get<{ username?: string; global_name?: string }>(token, "/users/@me");
      const name = me.global_name ?? me.username;
      return { ok: true, accountLabel: name ? `Discord (${name})` : "Discord" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listChannels(token, args) {
    if (!args.guildId) return { text: "Provide the guildId (server id).", count: 0 };
    const channels = await get<DiscordChannel[]>(token, `/guilds/${encodeURIComponent(args.guildId)}/channels`);
    const list = channels ?? [];
    const lines = ["| Channel | Type | Channel ID |", "| --- | --- | --- |"];
    for (const c of list) {
      const type = c.type != null ? (CHANNEL_TYPES[c.type] ?? String(c.type)) : "";
      lines.push(`| ${cell(c.name)} | ${type} | ${cell(c.id)} |`);
      if (lines.join("\n").length > CHAR_CAP) break;
    }
    return {
      text: list.length ? lines.join("\n") : "_No channels._",
      count: list.length,
    };
  },

  async listMessages(token, args) {
    if (!args.channelId) return { text: "Provide the channelId.", count: 0, truncated: false };
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const messages = await get<DiscordMessage[]>(
      token,
      `/channels/${encodeURIComponent(args.channelId)}/messages`,
      { limit },
    );
    const list = messages ?? [];
    const lines = ["| Author | Message | Sent |", "| --- | --- | --- |"];
    let truncated = false;
    for (const m of list) {
      const author = m.author?.global_name ?? m.author?.username ?? "";
      const sent = m.timestamp ? cell(m.timestamp).slice(0, 16) : "";
      lines.push(`| ${cell(author)} | ${cell(m.content).slice(0, 160)} | ${sent} |`);
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: list.length ? lines.join("\n") : "_No messages._",
      count: list.length,
      truncated,
    };
  },
};
