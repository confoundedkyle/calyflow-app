import "server-only";
import { getConnection } from "./queries";
import { getValidAccessToken } from "./integrations";
import { slackAdapter, type SlackChannel } from "./integrations/slack";

/** Whether the workspace has an active Slack connection (drives the settings UI). */
export async function isSlackConnected(workspaceId: string): Promise<boolean> {
  const connection = await getConnection(workspaceId, "slack");
  return !!connection && connection.status === "active";
}

/** Channels for the project channel picker, or null when Slack isn't connected
 *  (or the listing failed — the UI falls back to a manual channel-id input). */
export async function listSlackChannels(
  workspaceId: string,
): Promise<SlackChannel[] | null> {
  const connection = await getConnection(workspaceId, "slack");
  if (!connection || connection.status !== "active") return null;
  try {
    const token = await getValidAccessToken(connection);
    return await slackAdapter.listChannels(token);
  } catch {
    return null;
  }
}

// Server-side Slack helpers for non-LLM paths (the daily-report cron). The agent
// tools in lib/agents/tools.ts cover the in-run path; this covers code that
// posts directly without a model in the loop.

/**
 * Convert the Markdown an agent or template produces into Slack mrkdwn, which
 * differs in a few ways: *bold* (single asterisk), _italic_, <url|label> links,
 * and no real heading syntax (we bold headings instead). Best-effort — Slack
 * renders unknown Markdown literally, so the goal is "reads well in a channel",
 * not a perfect AST transform.
 */
export function markdownToMrkdwn(md: string): string {
  let out = md;
  // Fenced code blocks: Slack uses ``` too, but strip the language hint.
  out = out.replace(/```[a-zA-Z0-9]*\n/g, "```\n");
  // Links [label](url) → <url|label> (before bold/italic touch the brackets).
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");
  // Bold **text** or __text__ → *text*.
  out = out.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  out = out.replace(/__([^_]+)__/g, "*$1*");
  // Headings (#, ##, …) → bold line.
  out = out.replace(/^#{1,6}\s+(.*)$/gm, "*$1*");
  // Bullet markers - / * at line start → • .
  out = out.replace(/^\s*[-*]\s+/gm, "• ");
  return out.trim();
}

/** Slack hard-limits a message to 40k chars; keep margin and add a note. */
function clip(text: string): string {
  const MAX = 38_000;
  return text.length > MAX ? `${text.slice(0, MAX)}\n…(truncated)` : text;
}

/**
 * Post Markdown/mrkdwn text to a workspace's Slack channel. Loads the workspace
 * Slack connection, decrypts the bot token, ensures the bot is in the channel,
 * and posts. Returns false (without throwing) when the workspace has no active
 * Slack connection, so a batch caller (the cron) can skip and continue.
 */
export async function postToChannel(
  workspaceId: string,
  channelId: string,
  markdown: string,
  opts: { threadTs?: string } = {},
): Promise<{ ok: boolean; reason?: string; ts?: string }> {
  const connection = await getConnection(workspaceId, "slack");
  if (!connection || connection.status !== "active") {
    return { ok: false, reason: "Slack not connected" };
  }
  const token = await getValidAccessToken(connection);
  await slackAdapter.joinChannel(token, channelId);
  const { ok, ts } = await slackAdapter.postMessage(token, {
    channel: channelId,
    text: clip(markdownToMrkdwn(markdown)),
    threadTs: opts.threadTs,
  });
  return { ok, ts };
}

/**
 * Guidance appended to an agent's system prompt when its output is going to
 * Slack (the inbound bot — PR2). Embeds how to communicate with a hiring
 * manager in a channel: short, decisions-first, no recruiter jargon, Slack
 * formatting. Kept here so the connector "knows how to talk to hiring managers"
 * in one place.
 */
export function slackDeliveryBlock(): string {
  return [
    "# Delivering this in Slack",
    "Your reply is posted into a Slack channel read by a hiring manager (and " +
      "sometimes a recruiter). Communicate accordingly:",
    "- Lead with the answer or the decision needed — no preamble.",
    "- Be concise: a hiring manager skims on mobile. Short paragraphs and bullets.",
    "- Plain language, not recruiter jargon (avoid \"talent pipeline\", \"reqs\", " +
      "\"sourcing funnel\"). Explain any candidate count in human terms.",
    "- Be explicit about what you need FROM the hiring manager and by when.",
    "- Use Slack mrkdwn: *bold*, _italic_, `code`, and <https://url|label> links " +
      "(not Markdown [label](url) or # headings).",
    "- Never invent facts about candidates, the client, or the role.",
  ].join("\n");
}
