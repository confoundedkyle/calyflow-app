import { after, NextRequest, NextResponse } from "next/server";
import { getProjectBySlackChannel } from "@/lib/queries";
import { verifySlackRequest } from "@/lib/slack-verify";
import {
  agentMenuText,
  listRunnableAgents,
  parseInvocation,
  resolveAgentForToken,
  runAndPost,
} from "@/lib/agents/slack-bot";

// The /calyflow slash command. Slack requires a 200 within 3s, so we verify,
// resolve, ack with an ephemeral message, and run the agent in `after()` (which
// runs up to maxDuration on our Node/Docker deployment), posting the result to
// the channel when done.
export const maxDuration = 600;

function ephemeral(text: string) {
  return NextResponse.json({ response_type: "ephemeral", text });
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

  const form = new URLSearchParams(raw);
  const channelId = form.get("channel_id") ?? "";
  const text = form.get("text") ?? "";

  const project = await getProjectBySlackChannel(channelId);
  if (!project) {
    return ephemeral(
      "This channel isn't linked to a Calyflow project yet. Link it in the " +
        "project's *Settings* tab, then run `/calyflow` here.",
    );
  }
  const workspaceId = project.client.workspace_id;
  const agents = await listRunnableAgents(workspaceId);

  const { token, task } = parseInvocation(text);
  if (!token) {
    return ephemeral(agentMenuText(agents));
  }
  const agent = resolveAgentForToken(agents, token);
  if (!agent) {
    return ephemeral(
      `I don't have an agent called \`${token}\`.\n\n${agentMenuText(agents)}`,
    );
  }

  // Ack now; do the long-running agent work after the response is sent.
  after(() =>
    runAndPost({ workspaceId, project, agent, task, channelId }),
  );

  return ephemeral(
    `🤖 Running *${agent.name}*… I'll post the result in this channel shortly.`,
  );
}
