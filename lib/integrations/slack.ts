import "server-only";
import { env } from "../env";
import type { ConnectorAdapter, OAuthTokens } from "./types";

// Slack (OAuth v2, bot token). Shared-app model: the hosted Calyflow Slack app
// (or a self-hoster's own app) lives in env, so workspaces connect in one click;
// the start/callback routes also accept a per-workspace OAuth app (BYO fallback)
// via the `app` argument. Unlike Google/Vincere, the credential we store is the
// BOT token from the top-level `access_token` of oauth.v2.access — it does NOT
// expire and has no refresh flow, so we persist it with token_expires_at = null
// and omit refreshToken entirely (getValidAccessToken then treats it like an
// api-key token: decrypt and use as-is).
//
// Scopes are bot scopes. chat:write posts messages; channels:read +
// groups:read list public/private channels for the project channel picker;
// channels:join lets the bot add itself to a public channel it should post in;
// channels:manage lets it create the per-project "dedicated channel";
// users:read resolves member names for nicer reports; commands powers the
// /calyflow slash command and app_mentions:read delivers @Calyflow mentions
// (the inbound bot — workspaces connected before these scopes existed must
// reconnect to grant them).
const OAUTH_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const OAUTH_TOKEN = "https://slack.com/api/oauth.v2.access";
const SLACK_API = "https://slack.com/api";

export const SLACK_BOT_SCOPES = [
  "chat:write",
  "channels:read",
  "channels:join",
  "channels:manage",
  "groups:read",
  "users:read",
  "commands",
  "app_mentions:read",
].join(",");

/** A Slack conversation (channel) surfaced in the project channel picker. */
export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

export interface SlackAdapter extends ConnectorAdapter {
  /** Post a message (Slack mrkdwn) to a channel id, optionally threaded under a
   *  parent message (threadTs). Returns the message ts. */
  postMessage(
    botToken: string,
    args: { channel: string; text: string; threadTs?: string },
  ): Promise<{ ok: boolean; ts?: string }>;
  /** List the channels the bot can see, for the project channel picker. */
  listChannels(botToken: string): Promise<SlackChannel[]>;
  /** Create a public channel (e.g. a dedicated per-project channel). */
  createChannel(
    botToken: string,
    name: string,
  ): Promise<{ id: string; name: string }>;
  /** Join a public channel so the bot can post in it. Idempotent. */
  joinChannel(botToken: string, channel: string): Promise<void>;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string; // bot token (we store this)
  scope?: string;
  team?: { id?: string; name?: string };
  authed_user?: { id?: string };
}

async function api<T extends { ok: boolean; error?: string }>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) throw new Error(`Slack ${method} returned no JSON (${res.status})`);
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? "unknown"}`);
  return json;
}

export const slackAdapter: SlackAdapter = {
  provider: "slack",
  authType: "oauth",

  getAuthorizeUrl({ state, redirectUri, app }) {
    const params = new URLSearchParams({
      client_id: app?.clientId || env.slackClientId,
      scope: SLACK_BOT_SCOPES,
      redirect_uri: redirectUri,
      state,
    });
    return `${OAUTH_AUTHORIZE}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri, app }) {
    const res = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: app?.clientId || env.slackClientId,
        client_secret: app?.clientSecret || env.slackClientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const json = (await res.json().catch(() => null)) as SlackOAuthResponse | null;
    if (!json?.ok || !json.access_token) {
      throw new Error(`Slack token exchange failed: ${json?.error ?? res.status}`);
    }
    const tokens: OAuthTokens = {
      accessToken: json.access_token,
      // Slack bot tokens don't expire and don't rotate.
      expiresAt: null,
      scopes: json.scope,
      accountLabel: json.team?.name ?? "Slack workspace",
    };
    return tokens;
  },

  async postMessage(botToken, { channel, text, threadTs }) {
    const json = await api<{ ok: boolean; ts?: string }>(
      botToken,
      "chat.postMessage",
      {
        channel,
        text,
        unfurl_links: false,
        mrkdwn: true,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      },
    );
    return { ok: json.ok, ts: json.ts };
  },

  async listChannels(botToken) {
    const out: SlackChannel[] = [];
    let cursor: string | undefined;
    // Page through public + private channels (a couple of pages is plenty for a
    // picker; cap to avoid an unbounded loop on huge workspaces).
    for (let page = 0; page < 5; page += 1) {
      const json = await api<{
        ok: boolean;
        channels?: {
          id: string;
          name: string;
          is_private?: boolean;
          is_member?: boolean;
          is_archived?: boolean;
        }[];
        response_metadata?: { next_cursor?: string };
      }>(botToken, "conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const c of json.channels ?? []) {
        if (c.is_archived) continue;
        out.push({
          id: c.id,
          name: c.name,
          isPrivate: !!c.is_private,
          isMember: !!c.is_member,
        });
      }
      cursor = json.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  async createChannel(botToken, name) {
    const json = await api<{
      ok: boolean;
      channel?: { id: string; name: string };
    }>(botToken, "conversations.create", { name, is_private: false });
    if (!json.channel) throw new Error("Slack conversations.create returned no channel");
    return { id: json.channel.id, name: json.channel.name };
  },

  async joinChannel(botToken, channel) {
    try {
      await api(botToken, "conversations.join", { channel });
    } catch {
      // Already a member, or a private channel the bot was invited to — non-fatal.
    }
  },
};
