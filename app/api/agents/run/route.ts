import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs } from "ai";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkBudgets } from "@/lib/budgets";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  computeCostUsd,
  getLanguageModel,
  resolveRunProviders,
} from "@/lib/providers";
import {
  getConnection,
  getProject,
  getUserPreferences,
  getWorkspaceAgent,
} from "@/lib/queries";
import {
  CONNECTOR_CATEGORY_LABELS,
  connectorLabel,
  connectorsForCategory,
  expandConnectorPlaceholders,
  providerToolPrefix,
  requiredConnectorCategories,
} from "@/lib/connectors";
import { assembleContext } from "@/lib/context";
import {
  parseEffort,
  effortMaxSteps,
  effortGuidance,
  effortModelTuning,
} from "@/lib/effort";
import { ALL_TOOL_NAMES, buildTools, type ToolContext } from "@/lib/agents/tools";
import {
  resolveConnectorTokens,
  resolveFirecrawlKey,
  type ConnectorTokens,
} from "@/lib/agents/connector-tokens";
import { contextBlock, personalBlock } from "@/lib/agents/prompt";
import type { AgentRunStep } from "@/lib/types";

export const maxDuration = 600; // multi-step tool loops can run long

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

/** A file the user attached for this run only (extracted client-side text,
 *  never stored as a project document). */
interface RunAttachment {
  name: string;
  text: string;
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACH_CHARS = 200_000; // keep the injected block within a sane budget

/** Validate + cap the attachments the client sent, trimming the total injected
 *  text so a few large files can't blow the context window. */
function parseAttachments(raw: unknown): RunAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: RunAttachment[] = [];
  let total = 0;
  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    const name =
      typeof rec.name === "string" && rec.name.trim()
        ? rec.name.trim().slice(0, 200)
        : "attachment";
    const room = MAX_ATTACH_CHARS - total;
    if (room <= 0) break;
    const clipped = text.length > room ? `${text.slice(0, room)}\n…[truncated]` : text;
    total += clipped.length;
    out.push({ name, text: clipped });
  }
  return out;
}

/** System-prompt block holding the run's attached files, mirroring how project
 *  context is folded in — the agent uses them directly instead of searching. */
function attachmentsBlock(attachments: RunAttachment[]): string {
  if (attachments.length === 0) return "";
  const body = attachments.map((a) => `## ${a.name}\n${a.text}`).join("\n\n");
  return (
    "# Files attached to this run\n" +
    "The user attached the following file(s) for this run only — they are not " +
    "saved to the project. Treat them as primary input for the task. Their full " +
    "text is included here, so don't call the search/read tools to find them.\n\n" +
    body
  );
}

function summarize(value: unknown): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const projectId = String(body?.projectId ?? "");
  const agentId = String(body?.agentId ?? "");
  const task = typeof body?.task === "string" ? body.task : "";
  const attachments = parseAttachments(body?.attachments);
  // How hard the agent should work this run — tunes the tool-call budget and
  // the research-depth guidance injected below. Defaults to medium.
  const effort = parseEffort(body?.effort);
  // Continuing an existing chat when a valid conversation id is passed; a new
  // conversation otherwise. Each turn is still its own agent_runs row.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const continuingId =
    typeof body?.conversationId === "string" && UUID_RE.test(body.conversationId)
      ? body.conversationId
      : null;
  const conversationId = continuingId ?? crypto.randomUUID();

  const [project, agent] = await Promise.all([
    getProject(session.workspaceId, projectId),
    getWorkspaceAgent(session.workspaceId, agentId),
  ]);
  if (!project || !agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (agent.archived_at) {
    return NextResponse.json(
      { error: "This agent is archived. Restore it from Workflows & agents." },
      { status: 400 },
    );
  }
  if (project.status !== "active") {
    return NextResponse.json(
      { error: "This project is archived" },
      { status: 400 },
    );
  }

  // Resolve the primary provider (no mid-loop fallback for agent runs).
  const resolved = await resolveRunProviders(session.workspaceId);
  const primary = resolved.providers[0];
  if (!env.mockAi && !primary) {
    return NextResponse.json(
      { error: "No AI provider configured. Add one in Settings → AI Providers." },
      { status: 402 },
    );
  }
  const spendGate = await checkBudgets(session.workspace, "byo");
  if (spendGate.blocked && spendGate.reason === "spend_limit") {
    return NextResponse.json({ error: spendGate.message }, { status: 402 });
  }
  const platformGate = await checkBudgets(session.workspace, "calyflow");
  if (
    !env.mockAi &&
    primary.row.provider === "calyflow" &&
    platformGate.blocked &&
    platformGate.reason === "platform_credit"
  ) {
    return NextResponse.json({ error: platformGate.message }, { status: 402 });
  }

  // Category-generic agents carry "connector:<category>" placeholders in
  // allowed_tools. The caller picks one connected provider per category; the
  // placeholder expands to that provider's concrete tools.
  const connectorChoices: Record<string, string> =
    body?.connectors && typeof body.connectors === "object"
      ? body.connectors
      : {};
  const baseAllowed: string[] = Array.isArray(agent.allowed_tools)
    ? agent.allowed_tools
    : [];
  const chosenSources: { label: string; provider: string; prefix: string }[] =
    [];
  for (const category of requiredConnectorCategories(baseAllowed)) {
    const label = CONNECTOR_CATEGORY_LABELS[category];
    const provider = connectorChoices[category];
    if (!provider) {
      return NextResponse.json(
        { error: `Select a ${label} connector for this run.` },
        { status: 400 },
      );
    }
    if (!connectorsForCategory(category).some((c) => c.provider === provider)) {
      return NextResponse.json(
        { error: `${connectorLabel(provider)} is not a ${label} connector.` },
        { status: 400 },
      );
    }
    const connection = await getConnection(session.workspaceId, provider);
    if (!connection) {
      return NextResponse.json(
        {
          error: `${connectorLabel(provider)} is not connected. Set it up in Settings → Connectors.`,
        },
        { status: 400 },
      );
    }
    chosenSources.push({ label, provider, prefix: providerToolPrefix(provider) });
  }
  // Strip connector:<category> placeholders and expand each bound category to
  // its provider's concrete tools (shared with the automation cron).
  const allowed = expandConnectorPlaceholders(
    baseAllowed,
    connectorChoices,
    ALL_TOOL_NAMES,
  );

  // Resolve a valid token for each connector the agent uses, up front
  // (refreshing if needed). A configured-but-broken connection fails the run
  // early with a clear reconnect message; a not-yet-connected one stays null so
  // its tools report "not connected" rather than failing the whole run.
  let connectorTokens: ConnectorTokens;
  try {
    connectorTokens = await resolveConnectorTokens(session.workspaceId, allowed);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Connection error" },
      { status: 400 },
    );
  }

  const provider = env.mockAi ? "calyflow" : primary.row.provider;
  const model = env.mockAi
    ? "mock-model"
    : agent.model || primary.model;

  // Open the run row up front so the trace is recorded even on failure.
  const { data: run, error: runInsertError } = await db()
    .from("agent_runs")
    .insert({
      project_id: projectId,
      workspace_agent_id: agentId,
      conversation_id: conversationId,
      status: "running",
      task: task.trim() || null,
      provider,
      model,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (runInsertError || !run) {
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }
  const runId = run.id as string;

  getPostHogClient().capture({
    distinctId: session.userId,
    event: "agent_run_started",
    properties: {
      run_id: runId,
      agent_id: agentId,
      agent_name: agent.name,
      project_id: projectId,
      workspace_id: session.workspaceId,
      provider,
      model,
      has_task: !!task.trim(),
      has_attachments: attachments.length > 0,
    },
  });

  const ctx: ToolContext = {
    workspaceId: session.workspaceId,
    projectId,
    clientId: project.client.id,
    userId: session.userId,
    ...connectorTokens,
    firecrawlKey: await resolveFirecrawlKey(session.workspaceId),
    createdDocIds: [],
  };

  const userPrompt = task.trim()
    ? task.trim()
    : "Carry out your standard task for this project.";

  // Tell a category-generic agent which provider the user picked, so its
  // generic instructions resolve to concrete tool names.
  let systemPrompt = agent.instructions;
  if (chosenSources.length > 0) {
    const lines = chosenSources.map(
      (s) =>
        `- ${s.label}: ${connectorLabel(s.provider)} — its tools start with \`${s.prefix}\`.`,
    );
    systemPrompt +=
      `\n\n## Connected sources for this run\n${lines.join("\n")}\n` +
      "Use only these sources for their category; other providers' tools are not available in this run.";
  }

  // Pre-load project + KB context (the JD, scorecards, notes) into the system
  // prompt so the agent has full context up front — same assembly the workflow
  // runs use. Failure here must not abort the run; the read tools still work.
  try {
    const assembled = await assembleContext(
      session.workspaceId,
      project,
      [],
      "",
    );
    const block = contextBlock(assembled);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Agent context assembly failed:", err);
  }

  // Fold in the recruiter's own details (Settings > Personal) AFTER the project
  // context so it reads as the higher-priority override for every agent.
  try {
    const prefs = await getUserPreferences(session.workspaceId, session.userId);
    const block = personalBlock(prefs);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Personal preferences load failed:", err);
  }

  // Fold in any files the user attached for this run only (extracted text;
  // never stored as project documents).
  const attachBlock = attachmentsBlock(attachments);
  if (attachBlock) systemPrompt = `${systemPrompt}\n\n${attachBlock}`;

  // Tell the agent how hard to work this run (how broadly to use its tools).
  // Paired with the effort-scaled step budget on `stopWhen` below.
  systemPrompt = `${systemPrompt}\n\n${effortGuidance(effort)}`;

  // Thread the earlier turns of this conversation back as context (each user
  // task + the assistant's saved reply) so a follow-up continues the chat.
  const priorMessages: { role: "user" | "assistant"; content: string }[] = [];
  if (continuingId) {
    const { data: prior } = await db()
      .from("agent_runs")
      .select("task, output_text, created_at")
      .eq("project_id", projectId)
      .eq("workspace_agent_id", agentId)
      .eq("conversation_id", conversationId)
      .neq("id", runId)
      .order("created_at", { ascending: true });
    for (const turn of prior ?? []) {
      priorMessages.push({
        role: "user",
        content: (turn.task as string | null)?.trim() || "(standard task)",
      });
      const out = (turn.output_text as string | null)?.trim();
      if (out) priorMessages.push({ role: "assistant", content: out });
    }
  }
  const messages = [
    ...priorMessages,
    { role: "user" as const, content: userPrompt },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const steps: AgentRunStep[] = [];
      let outputText = "";
      let finishReason: string | undefined;
      let usage = {
        inputTokens: undefined as number | undefined,
        outputTokens: undefined as number | undefined,
        cachedInputTokens: undefined as number | undefined,
      };
      let failure: string | null = null;

      try {
        if (env.mockAi) {
          const text =
            "**Mock agent run** (MOCK_AI=true): no provider or tools were called.";
          outputText = text;
          controller.enqueue(ndjson({ type: "text", value: text }));
          usage = { inputTokens: 500, outputTokens: 60, cachedInputTokens: 0 };
        } else {
          const lm = await getLanguageModel(
            primary.row.provider,
            primary.apiKey,
            model,
          );
          const tools = buildTools(ctx, allowed);
          // Map the effort slider to the model's reasoning lever for the run's
          // effective provider (platform "calyflow" → its real provider).
          const effectiveProvider =
            provider === "calyflow" ? env.platformProvider : provider;
          const tuning = effortModelTuning(effort, effectiveProvider, model);
          let streamError: unknown = null;
          const result = streamText({
            model: lm,
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(effortMaxSteps(agent.max_steps, effort)),
            abortSignal: AbortSignal.timeout(540_000),
            providerOptions:
              tuning.providerOptions as Parameters<
                typeof streamText
              >[0]["providerOptions"],
            ...(tuning.maxOutputTokens
              ? { maxOutputTokens: tuning.maxOutputTokens }
              : {}),
            onError: ({ error }) => {
              streamError = error;
            },
          });

          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              outputText += part.text;
              controller.enqueue(ndjson({ type: "text", value: part.text }));
            } else if (part.type === "tool-call") {
              steps.push({
                type: "tool-call",
                tool: part.toolName,
                summary: summarize(part.input),
              });
              controller.enqueue(
                ndjson({
                  type: "tool-call",
                  tool: part.toolName,
                  summary: summarize(part.input),
                }),
              );
            } else if (part.type === "tool-result") {
              steps.push({
                type: "tool-result",
                tool: part.toolName,
                summary: summarize(part.output),
              });
              controller.enqueue(
                ndjson({
                  type: "tool-result",
                  tool: part.toolName,
                  summary: summarize(part.output),
                }),
              );
            } else if (part.type === "tool-error") {
              steps.push({
                type: "tool-error",
                tool: part.toolName,
                summary: summarize(part.error),
              });
              controller.enqueue(
                ndjson({
                  type: "tool-result",
                  tool: part.toolName,
                  summary: summarize(part.error),
                }),
              );
            } else if (part.type === "error") {
              streamError = part.error;
            }
          }

          if (streamError) throw streamError;
          finishReason = await result.finishReason;
          const totalUsage = await result.totalUsage;
          usage = {
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            cachedInputTokens: (
              totalUsage as { cachedInputTokens?: number }
            ).cachedInputTokens,
          };
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : "Agent run failed";
      }

      const succeeded = failure === null;
      const outputDocId = ctx.createdDocIds.at(-1) ?? null;

      // A run can finish "successfully" yet produce nothing — most often when the
      // model exhausts its step budget mid tool-loop (finishReason "tool-calls"
      // /"length"). Surface that instead of a blank result so the user knows to
      // re-run rather than staring at an empty page.
      if (succeeded && !outputText.trim() && !outputDocId) {
        outputText =
          finishReason === "tool-calls" || finishReason === "length"
            ? "I gathered a lot of research but ran out of room before writing it up. Run me again and I'll get to a result — narrowing the request a little helps me wrap up faster."
            : "I wasn't able to put together a result this time. Mind running it again, or rephrasing the request a little?";
        controller.enqueue(ndjson({ type: "text", value: outputText }));
      }

      const costUsd = await computeCostUsd(provider, model, usage).catch(
        () => null,
      );

      // On failure, keep the assembled prompt (system + user message) so we can
      // analyse what was sent without re-running. Capped, and null on success to
      // avoid storing large prompts for every run. Also log a concise line for
      // immediate visibility in server logs.
      const failurePrompt = succeeded
        ? null
        : `${systemPrompt}\n\n# User message\n${userPrompt}`.slice(0, 100_000);
      if (!succeeded) {
        console.error("Agent run failed", {
          runId,
          agentId,
          agentName: agent.name,
          projectId,
          workspaceId: session.workspaceId,
          provider,
          model,
          steps: steps.length,
          error: failure,
          task: task.trim() || null,
        });
      }

      await db()
        .from("agent_runs")
        .update({
          status: succeeded ? "succeeded" : "failed",
          steps,
          output_text: outputText || null,
          output_doc_id: outputDocId,
          error_message: failure ? failure.slice(0, 500) : null,
          prompt: failurePrompt,
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          cache_read_tokens: usage.cachedInputTokens ?? null,
          cost_usd: costUsd,
        })
        .eq("id", runId);

      if (provider === "calyflow" && costUsd) {
        await db().rpc("increment_platform_spent", {
          p_workspace_id: session.workspaceId,
          p_amount: costUsd,
        });
      }

      getPostHogClient().capture({
        distinctId: session.userId,
        event: "agent_run_completed",
        properties: {
          run_id: runId,
          agent_id: agentId,
          agent_name: agent.name,
          project_id: projectId,
          workspace_id: session.workspaceId,
          succeeded,
          provider,
          model,
          step_count: steps.length,
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          cost_usd: costUsd,
          has_output_doc: outputDocId !== null,
        },
      });

      // Activation funnel. Demo-project runs are practice, not activation — they
      // get their own event. A successful run in a REAL project is the canonical
      // `activated` moment: stamp workspaces.activated_at exactly once (guarded
      // conditional update is race-safe) and fire the event only on that first
      // transition, so nudges can filter on activated_at and the metric is clean.
      if (project.is_demo) {
        if (succeeded) {
          getPostHogClient().capture({
            distinctId: session.userId,
            event: "demo_run",
            properties: {
              run_id: runId,
              agent_id: agentId,
              agent_name: agent.name,
              workspace_id: session.workspaceId,
            },
          });
        }
      } else if (succeeded) {
        const { data: activatedRows } = await db()
          .from("workspaces")
          .update({ activated_at: new Date().toISOString() })
          .eq("id", session.workspaceId)
          .is("activated_at", null)
          .select("id");
        if ((activatedRows?.length ?? 0) > 0) {
          const createdAt = session.workspace.created_at;
          getPostHogClient().capture({
            distinctId: session.userId,
            event: "activated",
            properties: {
              run_id: runId,
              agent_id: agentId,
              agent_name: agent.name,
              project_id: projectId,
              workspace_id: session.workspaceId,
              time_to_activate_seconds: createdAt
                ? Math.round((Date.now() - new Date(createdAt).getTime()) / 1000)
                : null,
            },
          });
        }
      }

      if (!succeeded) {
        controller.enqueue(ndjson({ type: "error", message: failure }));
      }
      controller.enqueue(
        ndjson({ type: "done", runId, conversationId, outputDocId, succeeded }),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Run-Id": runId,
    },
  });
}
