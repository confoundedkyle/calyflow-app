import { after, NextRequest, NextResponse } from "next/server";
import { getProjectBySlackChannel } from "@/lib/queries";
import { postToChannel } from "@/lib/slack";
import { verifySlackRequest } from "@/lib/slack-verify";
import {
  agentMenuText,
  listRunnableAgents,
  parseInvocation,
  resolveAgentForToken,
  runAndPost,
} from "@/lib/agents/slack-bot";

// The Slack Events API endpoint — delivers @Calyflow mentions. Like the slash
// command, we ack fast (Slack retries on >3s) and run the agent in `after()`,
// replying in a thread under the mention.
export const maxDuration = 600;

const ok = () => NextResponse.json({ ok: true });

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    text?: string;
    channel?: string;
    ts?: string;
    bot_id?: string;
    subtype?: string;
  };
}

/** Resolve + run a mention, replying in a thread under it. Runs in `after()`. */
async function handleMention(
  channelId: string,
  rawText: string,
  threadTs: string,
): Promise<void> {
  const project = await getProjectBySlackChannel(channelId);
  // No mapped project → no workspace whose bot token we could post with, so we
  // can't reply. Drop silently (expected in an unlinked channel).
  if (!project) return;
  const workspaceId = project.client.workspace_id;
  // Strip the leading "<@BOTID>" mention, then parse "<agent> <task>".
  const text = rawText.replace(/<@[^>]+>/, "").trim();
  const agents = await listRunnableAgents(workspaceId);
  const { token, task } = parseInvocation(text);
  if (!token) {
    await postToChannel(workspaceId, channelId, agentMenuText(agents), { threadTs });
    return;
  }
  const agent = resolveAgentForToken(agents, token);
  if (!agent) {
    await postToChannel(
      workspaceId,
      channelId,
      `I don't have an agent called \`${token}\`.\n\n${agentMenuText(agents)}`,
      { threadTs },
    );
    return;
  }
  await postToChannel(
    workspaceId,
    channelId,
    `🤖 Running *${agent.name}*…`,
    { threadTs },
  ).catch(() => {});
  await runAndPost({ workspaceId, project, agent, task, channelId, threadTs });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const verdict = verifySlackRequest(
    raw,
    request.headers.get("x-slack-signature"),
    request.headers.get("x-slack-request-timestamp"),
  );
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  const body = JSON.parse(raw) as SlackEventEnvelope;

  // One-time endpoint verification handshake when configuring Event Subscriptions.
  if (body.type === "url_verification" && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  const event = body.event;
  if (body.type !== "event_callback" || event?.type !== "app_mention") {
    return ok();
  }
  // Skip Slack retries (we already accepted the first) and the bot's own posts
  // (avoids a mention→reply→mention loop).
  if (request.headers.get("x-slack-retry-num")) return ok();
  if (event.bot_id || event.subtype === "bot_message") return ok();
  if (!event.channel || !event.ts) return ok();

  const channelId = event.channel;
  const threadTs = event.ts;
  const text = event.text ?? "";
  after(() => handleMention(channelId, text, threadTs));
  return ok();
}
