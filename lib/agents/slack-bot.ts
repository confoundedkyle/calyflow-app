import "server-only";
import { env } from "../env";
import {
  getWorkspaceServiceUserId,
  listWorkspaceAgents,
} from "../queries";
import { postToChannel, slackDeliveryBlock } from "../slack";
import type { Client, Project, WorkspaceAgent } from "../types";
import { runAgentHeadless } from "./run";

// Shared core for the inbound Slack bot — the slash command and @mention routes
// both parse "<agent-token> <task>", resolve the agent, run it headless as the
// workspace service identity, and post the result back. Kept route-agnostic so
// both entry points behave identically.

export type RunnableAgent = WorkspaceAgent & {
  library: { slug: string | null; context: string | null } | null;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The workspace's runnable agents for a project channel: non-archived and not
 *  business-development (a channel maps to a recruiting project). */
export async function listRunnableAgents(
  workspaceId: string,
): Promise<RunnableAgent[]> {
  const agents = (await listWorkspaceAgents(workspaceId)) as RunnableAgent[];
  return agents.filter(
    (a) => !a.archived_at && a.library?.context !== "business-development",
  );
}

/** Split a raw invocation into the agent token (first word) and the rest as the
 *  task. "" / "help" / "agents" yield no token (→ show the menu). */
export function parseInvocation(raw: string): {
  token: string | null;
  task: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { token: null, task: "" };
  const [first, ...rest] = trimmed.split(/\s+/);
  const token = first.toLowerCase();
  if (token === "help" || token === "agents" || token === "list") {
    return { token: null, task: "" };
  }
  return { token: first, task: rest.join(" ").trim() };
}

/** Resolve a typed token to one of the workspace's runnable agents — by library
 *  slug first (the stable id, e.g. "github-sourcer"), then by slugified name. */
export function resolveAgentForToken(
  agents: RunnableAgent[],
  token: string,
): RunnableAgent | null {
  const want = slugify(token);
  return (
    agents.find((a) => a.library?.slug && slugify(a.library.slug) === want) ??
    agents.find((a) => slugify(a.name) === want) ??
    null
  );
}

/** The "skill menu" reply listing what you can run, with a usage example. */
export function agentMenuText(agents: RunnableAgent[]): string {
  if (agents.length === 0) {
    return (
      "No recruiting agents are imported in this workspace yet. Import some from " +
      "the Library in Calyflow, then run them here."
    );
  }
  const lines = agents.map((a) => {
    const slug = a.library?.slug ?? slugify(a.name);
    return `• \`${slug}\` — ${a.name}`;
  });
  return [
    "*Run a recruiting agent in this channel:*",
    "`/calyflow <agent> <what you want>` — e.g. `/calyflow github-sourcer find 5 Rust engineers`",
    "",
    "*Available agents:*",
    ...lines,
  ].join("\n");
}

/** Run an agent for a channel's project and post the result back (threaded when
 *  threadTs is given). Surfaces a clear message on failure rather than going
 *  silent. Safe to call from `after()`. */
export async function runAndPost(args: {
  workspaceId: string;
  project: Project & { client: Pick<Client, "id"> };
  agent: RunnableAgent;
  task: string;
  channelId: string;
  threadTs?: string;
}): Promise<void> {
  const { workspaceId, project, agent, task, channelId, threadTs } = args;
  try {
    const userId = await getWorkspaceServiceUserId(workspaceId);
    const run = await runAgentHeadless({
      workspaceId,
      userId,
      project,
      agent,
      task: task || undefined,
      extraSystem: slackDeliveryBlock(),
    });

    let message: string;
    if (!run.succeeded) {
      message = `⚠️ *${agent.name}* couldn't finish: ${run.error ?? "unknown error"}`;
    } else if (!run.outputText.trim()) {
      message = `*${agent.name}* finished but produced no text output.`;
    } else {
      message = run.outputText;
      if (run.outputDocId && run.runId && env.appBaseUrl) {
        message += `\n\n📄 <${env.appBaseUrl}/agent-runs/${run.runId}|View the full result in Calyflow>`;
      }
    }
    await postToChannel(workspaceId, channelId, message, { threadTs });
  } catch (err) {
    await postToChannel(
      workspaceId,
      channelId,
      `⚠️ Something went wrong running *${agent.name}*: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
      { threadTs },
    ).catch(() => {});
  }
}
