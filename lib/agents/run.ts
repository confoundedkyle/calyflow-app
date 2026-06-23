import "server-only";
import { generateText, stepCountIs } from "ai";
import { db } from "../db";
import { env } from "../env";
import { assembleContext } from "../context";
import { getUserPreferences } from "../queries";
import {
  computeCostUsd,
  getLanguageModel,
  resolveRunProviders,
} from "../providers";
import { CONNECTOR_REQUIREMENT_PREFIX } from "../connectors";
import type { Client, Project, WorkspaceAgent } from "../types";
import { buildTools, type ToolContext } from "./tools";
import { resolveConnectorTokens } from "./connector-tokens";
import { contextBlock, personalBlock } from "./prompt";

export interface HeadlessRunResult {
  runId: string | null;
  succeeded: boolean;
  outputText: string;
  outputDocId: string | null;
  error?: string;
}

/**
 * Run an agent to completion without a session or a stream — for automated
 * triggers (the daily-report cron now; the inbound Slack bot in PR2). The
 * caller supplies the identity (workspaceId + userId) and the already-resolved
 * project and agent. Mirrors POST /api/agents/run: same provider resolution,
 * context assembly, tool building, agent_runs persistence and cost tracking,
 * but collects the full output instead of streaming it.
 *
 * Connector:<category> placeholders are dropped (headless runs don't prompt a
 * picker); bind a provider's tools directly in the agent's allowed_tools if a
 * connector is needed.
 */
export async function runAgentHeadless(params: {
  workspaceId: string;
  userId: string;
  /** The project, with at least its client id (used to scope context + tools).
   *  Null for workspace-level automation runs that aren't tied to a project. */
  project?: (Project & { client: Pick<Client, "id"> }) | null;
  agent: Pick<
    WorkspaceAgent,
    "id" | "instructions" | "allowed_tools" | "model" | "max_steps" | "name"
  >;
  task?: string;
  /** Extra system-prompt guidance appended last (e.g. Slack delivery rules). */
  extraSystem?: string;
  /** Set for Automation Hub runs — records the run against the automation
   *  (workspace_agent_id is left null) instead of a workspace agent. */
  workspaceAutomationId?: string;
}): Promise<HeadlessRunResult> {
  const { workspaceId, userId, agent, workspaceAutomationId } = params;
  const project = params.project ?? null;

  const resolved = await resolveRunProviders(workspaceId);
  const primary = resolved.providers[0];
  if (!env.mockAi && !primary) {
    return {
      runId: null,
      succeeded: false,
      outputText: "",
      outputDocId: null,
      error: "No AI provider configured for this workspace.",
    };
  }

  const allowed = (agent.allowed_tools ?? []).filter(
    (t) => !t.startsWith(CONNECTOR_REQUIREMENT_PREFIX),
  );

  let connectorTokens;
  try {
    connectorTokens = await resolveConnectorTokens(workspaceId, allowed);
  } catch (err) {
    return {
      runId: null,
      succeeded: false,
      outputText: "",
      outputDocId: null,
      error: err instanceof Error ? err.message : "Connection error",
    };
  }

  const provider = env.mockAi ? "calyflow" : primary!.row.provider;
  const model = env.mockAi ? "mock-model" : agent.model || primary!.model;

  const { data: run } = await db()
    .from("agent_runs")
    .insert({
      project_id: project?.id ?? null,
      workspace_agent_id: workspaceAutomationId ? null : agent.id,
      workspace_automation_id: workspaceAutomationId ?? null,
      conversation_id: crypto.randomUUID(),
      status: "running",
      task: params.task?.trim() || null,
      provider,
      model,
      created_by: userId,
    })
    .select("id")
    .single();
  const runId = (run?.id as string | undefined) ?? null;

  const ctx: ToolContext = {
    workspaceId,
    projectId: project?.id ?? "",
    clientId: project?.client.id ?? "",
    userId,
    ...connectorTokens,
    firecrawlKey: env.firecrawlApiKey || null,
    createdDocIds: [],
  };

  // Assemble the same project/KB + personal context the interactive route uses.
  // Skipped for workspace-level automation runs that have no project.
  let systemPrompt = agent.instructions;
  if (project) {
    try {
      // assembleContext only reads project.id + project.client.id; a partial
      // client (from the cron) is sufficient.
      const assembled = await assembleContext(
        workspaceId,
        project as Project & { client: Client },
        [],
        "",
      );
      const block = contextBlock(assembled);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch (err) {
      console.warn("Headless context assembly failed:", err);
    }
  }
  try {
    const prefs = await getUserPreferences(workspaceId, userId);
    const block = personalBlock(prefs);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Headless personal preferences load failed:", err);
  }
  if (params.extraSystem?.trim()) {
    systemPrompt = `${systemPrompt}\n\n${params.extraSystem.trim()}`;
  }

  const userPrompt =
    params.task?.trim() || "Carry out your standard task for this project.";

  let outputText = "";
  let failure: string | null = null;
  let usage = {
    inputTokens: undefined as number | undefined,
    outputTokens: undefined as number | undefined,
    cachedInputTokens: undefined as number | undefined,
  };

  try {
    if (env.mockAi) {
      outputText = "**Mock headless run** (MOCK_AI=true).";
      usage = { inputTokens: 500, outputTokens: 60, cachedInputTokens: 0 };
    } else {
      const lm = await getLanguageModel(primary!.row.provider, primary!.apiKey, model);
      const result = await generateText({
        model: lm,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: buildTools(ctx, allowed),
        stopWhen: stepCountIs(agent.max_steps ?? 12),
        abortSignal: AbortSignal.timeout(540_000),
      });
      outputText = result.text;
      const total = result.totalUsage;
      usage = {
        inputTokens: total.inputTokens,
        outputTokens: total.outputTokens,
        cachedInputTokens: (total as { cachedInputTokens?: number }).cachedInputTokens,
      };
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "Agent run failed";
  }

  const succeeded = failure === null;
  const outputDocId = ctx.createdDocIds.at(-1) ?? null;
  const costUsd = await computeCostUsd(provider, model, usage).catch(() => null);

  if (runId) {
    await db()
      .from("agent_runs")
      .update({
        status: succeeded ? "succeeded" : "failed",
        output_text: outputText || null,
        output_doc_id: outputDocId,
        error_message: failure ? failure.slice(0, 500) : null,
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
        cache_read_tokens: usage.cachedInputTokens ?? null,
        cost_usd: costUsd,
      })
      .eq("id", runId);
  }
  if (provider === "calyflow" && costUsd) {
    await db().rpc("increment_platform_spent", {
      p_workspace_id: workspaceId,
      p_amount: costUsd,
    });
  }

  return {
    runId,
    succeeded,
    outputText,
    outputDocId,
    error: failure ?? undefined,
  };
}
