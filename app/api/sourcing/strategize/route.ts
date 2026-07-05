import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs } from "ai";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkBudgets } from "@/lib/budgets";
import {
  computeCostUsd,
  getLanguageModel,
  resolveRunProviders,
} from "@/lib/providers";
import {
  getProject,
  getSessionTargets,
  getUserPreferences,
  listConnections,
} from "@/lib/queries";
import { connectedProvidersFrom } from "@/lib/run-items";
import { assembleContext } from "@/lib/context";
import {
  parseEffort,
  effortMaxSteps,
  effortGuidance,
  effortModelTuning,
} from "@/lib/effort";
import { buildTools, type ToolContext } from "@/lib/agents/tools";
import { finalizeWrite } from "@/lib/agents/finalize";
import {
  resolveConnectorTokens,
  resolveFirecrawlKey,
} from "@/lib/agents/connector-tokens";
import { contextBlock, personalBlock } from "@/lib/agents/prompt";
import { loadStrategistHarness } from "@/lib/sourcing/strategist";
import { sourcingChannelsBlock } from "@/lib/sourcing/channels";
import { buildRecruiterSteerBlock } from "@/lib/sourcing/steer";
import {
  getChannelSignals,
  formatChannelSignalsBlock,
  sessionProgress,
} from "@/lib/sourcing/signals";
import {
  effectiveSessionGoal,
  effectiveSessionBudgetUsd,
} from "@/lib/shortlist/budget";
import {
  listCandidatesCompact,
  listCandidateFeedback,
} from "@/lib/candidates/queries";
import { formatFeedbackBlock } from "@/lib/candidates/feedback";
import type { AgentRunStep } from "@/lib/types";

export const maxDuration = 300; // read-only planning; a few tool calls at most

// The strategist proposes — it never sources or spends contact credits. Give it
// just the read-only KB/candidate tools.
const STRATEGIST_BASE_STEPS = 10;
const STRATEGIST_TOOLS = [
  "calyflow_search_documents",
  "calyflow_read_document",
  "calyflow_list_candidates",
];

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
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

/** Live shortlist status so the proposal is sized to the real gap and budget. */
function statusBlock(
  totalCandidates: number,
  qualified: number,
  goal: number | null,
  spentUsd: number,
  budgetUsd: number | null,
): string {
  const lines = [
    `- Candidates saved so far: ${totalCandidates}`,
    `- Qualified so far: ${qualified}${goal ? ` (goal: ${goal})` : " (no goal set)"}`,
  ];
  if (budgetUsd != null) {
    lines.push(
      `- Budget: $${spentUsd.toFixed(2)} spent of $${budgetUsd.toFixed(2)} — ` +
        `$${Math.max(budgetUsd - spentUsd, 0).toFixed(2)} left`,
    );
  } else {
    lines.push("- Budget: no cap set");
  }
  return `# Current sourcing status\n${lines.join("\n")}`;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const projectId = String(body?.projectId ?? "");
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  const effort = parseEffort(body?.effort);

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const continuingId =
    typeof body?.conversationId === "string" && UUID_RE.test(body.conversationId)
      ? body.conversationId
      : null;
  const conversationId = continuingId ?? crypto.randomUUID();

  const project = await getProject(session.workspaceId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (project.status !== "active") {
    return NextResponse.json(
      { error: "This project is archived" },
      { status: 400 },
    );
  }

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
    primary!.row.provider === "calyflow" &&
    platformGate.blocked &&
    platformGate.reason === "platform_credit"
  ) {
    return NextResponse.json({ error: platformGate.message }, { status: 402 });
  }

  const provider = env.mockAi ? "calyflow" : primary!.row.provider;
  const model = env.mockAi ? "mock-model" : primary!.model;

  // Open the run row up front so the trace is recorded even on failure.
  const { data: run, error: runInsertError } = await db()
    .from("sourcing_strategy_runs")
    .insert({
      project_id: projectId,
      conversation_id: conversationId,
      status: "running",
      task: task || null,
      provider,
      model,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (runInsertError || !run) {
    console.error("Strategize: run insert failed", runInsertError);
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }
  const runId = run.id as string;

  // System prompt: strategist harness (generic or bucket IP) + cost-ordered
  // connected channels + project context (auto-includes the Sourcing Plan and
  // Qualification criteria) + this project's channel-performance signals +
  // recruiter feedback + live status + personal + effort.
  let systemPrompt = await loadStrategistHarness();
  let connectedProviders: string[] = [];

  try {
    const connections = await listConnections(session.workspaceId);
    connectedProviders = [...connectedProvidersFrom(connections)];
    systemPrompt = `${systemPrompt}\n\n${sourcingChannelsBlock(connectedProviders)}`;
  } catch (err) {
    console.warn("Strategize: channels block failed:", err);
  }

  const steerBlock = buildRecruiterSteerBlock(task, connectedProviders);
  if (steerBlock) systemPrompt = `${systemPrompt}\n\n${steerBlock}`;

  try {
    const assembled = await assembleContext(session.workspaceId, project, [], "");
    const block = contextBlock(assembled);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Strategize: context assembly failed:", err);
  }

  let signals: Awaited<ReturnType<typeof getChannelSignals>> | null = null;
  try {
    signals = await getChannelSignals(projectId);
    const block = formatChannelSignalsBlock(signals);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Strategize: channel signals failed:", err);
  }

  try {
    const fb = await listCandidateFeedback(projectId);
    const block = formatFeedbackBlock(fb.accepted, fb.rejected);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Strategize: feedback block failed:", err);
  }

  try {
    // Goal + budget are per SESSION; the project cap is the outer ceiling.
    const [compact, targets] = await Promise.all([
      listCandidatesCompact(projectId, 1),
      getSessionTargets(projectId, conversationId),
    ]);
    const sig = signals ?? (await getChannelSignals(projectId));
    const prog = sessionProgress(sig, conversationId);
    systemPrompt = `${systemPrompt}\n\n${statusBlock(
      compact.length,
      prog.qualified,
      effectiveSessionGoal(targets.goalQualified),
      prog.spent,
      effectiveSessionBudgetUsd(targets.budgetUsd),
    )}`;
  } catch (err) {
    console.warn("Strategize: status block failed:", err);
  }

  try {
    const prefs = await getUserPreferences(session.workspaceId, session.userId);
    const block = personalBlock(prefs);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Strategize: personal preferences load failed:", err);
  }

  systemPrompt = `${systemPrompt}\n\n${effortGuidance(effort)}`;

  const userPrompt = task
    ? `The recruiter's steer for the next sourcing search:\n\n${task}\n\n` +
      "Propose the next search accordingly, following your output contract."
    : "Propose the next sourcing search for this project, following your output " +
      "contract. If sourcing has already run, build on what worked and avoid what didn't.";

  // Thread earlier turns of this conversation back as context.
  const priorMessages: { role: "user" | "assistant"; content: string }[] = [];
  if (continuingId) {
    const { data: prior } = await db()
      .from("sourcing_strategy_runs")
      .select("task, output_text, created_at")
      .eq("project_id", projectId)
      .eq("conversation_id", conversationId)
      .neq("id", runId)
      .order("created_at", { ascending: true });
    for (const turn of prior ?? []) {
      priorMessages.push({
        role: "user",
        content:
          (turn.task as string | null)?.trim() || "(propose the next search)",
      });
      const out = (turn.output_text as string | null)?.trim();
      if (out) priorMessages.push({ role: "assistant", content: out });
    }
  }
  const messages = [
    ...priorMessages,
    { role: "user" as const, content: userPrompt },
  ];

  const ctx: ToolContext = {
    workspaceId: session.workspaceId,
    projectId,
    clientId: project.client.id,
    userId: session.userId,
    ...(await resolveConnectorTokens(session.workspaceId, [])),
    firecrawlKey: await resolveFirecrawlKey(session.workspaceId),
    createdDocIds: [],
  };

  // Track client disconnect so late enqueues after cancel/close don't throw
  // "Controller is already closed" — which would otherwise be caught below and
  // persisted as a spurious run failure when the user navigates away mid-stream.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (bytes: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(bytes);
        } catch {
          closed = true;
        }
      };
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
          outputText =
            `## Proposed next search (mock)\n\n` +
            "**Mock run** (MOCK_AI=true): no provider or tools were called.\n\n" +
            "1. web_search + SignalHire (free) — title/stack variants.\n" +
            "Estimated cost: ~$0. Approve to run.";
          safeEnqueue(ndjson({ type: "text", value: outputText }));
          usage = { inputTokens: 400, outputTokens: 60, cachedInputTokens: 0 };
        } else {
          const lm = await getLanguageModel(
            primary!.row.provider,
            primary!.apiKey,
            model,
          );
          const tools = buildTools(ctx, STRATEGIST_TOOLS);
          const effectiveProvider =
            provider === "calyflow" ? env.platformProvider : provider;
          const tuning = effortModelTuning(effort, effectiveProvider, model);
          let streamError: unknown = null;
          const result = streamText({
            model: lm,
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(effortMaxSteps(STRATEGIST_BASE_STEPS, effort)),
            abortSignal: AbortSignal.timeout(270_000),
            providerOptions: tuning.providerOptions as Parameters<
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
              safeEnqueue(ndjson({ type: "text", value: part.text }));
            } else if (part.type === "tool-call") {
              steps.push({
                type: "tool-call",
                tool: part.toolName,
                summary: summarize(part.input),
              });
              safeEnqueue(
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
              safeEnqueue(
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
              safeEnqueue(
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
            cachedInputTokens: (totalUsage as { cachedInputTokens?: number })
              .cachedInputTokens,
          };

          // If tool calls ate the step budget before the proposal was written,
          // feed the context back and force a tool-free write.
          if (
            !outputText.trim() &&
            (finishReason === "tool-calls" || finishReason === "length")
          ) {
            try {
              const prior = await result.response;
              const fin = await finalizeWrite({
                model: lm,
                system: systemPrompt,
                priorMessages: [...messages, ...prior.messages],
                nudge:
                  "You've read enough. Now write the proposed next sourcing search " +
                  "in markdown, following your output contract exactly. Do not " +
                  "call any tools.",
                onDelta: (t) =>
                  safeEnqueue(ndjson({ type: "text", value: t })),
              });
              outputText += fin.text;
              usage = {
                inputTokens:
                  (usage.inputTokens ?? 0) + (fin.usage.inputTokens ?? 0),
                outputTokens:
                  (usage.outputTokens ?? 0) + (fin.usage.outputTokens ?? 0),
                cachedInputTokens:
                  (usage.cachedInputTokens ?? 0) +
                  (fin.usage.cachedInputTokens ?? 0),
              };
            } catch (err) {
              console.warn("Strategize: finalize write failed:", err);
            }
          }
        }
      } catch (error) {
        failure =
          error instanceof Error ? error.message : "Strategize run failed";
      }

      // A client disconnect / stream cancel isn't a real failure — keep whatever
      // was produced so navigating back shows the proposal, not a red error.
      if (
        failure &&
        (closed || /already closed|aborted|cancel/i.test(failure))
      ) {
        failure = null;
      }
      const succeeded = failure === null;
      if (succeeded && !outputText.trim()) {
        outputText =
          "I couldn't put together a proposal this time. Mind trying again, or " +
          "giving me a steer (which channel to try)?";
        safeEnqueue(ndjson({ type: "text", value: outputText }));
      }

      const costUsd = await computeCostUsd(provider, model, usage).catch(
        () => null,
      );

      await db()
        .from("sourcing_strategy_runs")
        .update({
          status: succeeded ? "succeeded" : "failed",
          steps,
          output_text: outputText || null,
          error_message: failure ? failure.slice(0, 500) : null,
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

      if (!succeeded) {
        safeEnqueue(ndjson({ type: "error", message: failure }));
      }
      safeEnqueue(
        ndjson({
          type: "done",
          runId,
          conversationId,
          succeeded,
          proposal: succeeded ? outputText : null,
        }),
      );
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed by a client disconnect — fine */
      }
    },
    cancel() {
      // The client navigated away / aborted the fetch. Stop enqueuing; the
      // finalization above still records whatever was produced.
      closed = true;
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
