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
  getActiveQualification,
  getProject,
  getUserPreferences,
} from "@/lib/queries";
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
import {
  loadQualificationHarness,
  HarnessNotProvisionedError,
} from "@/lib/qualification/harness";
import { saveQualification } from "@/lib/qualification/save";
import type { AgentRunStep } from "@/lib/types";

export const maxDuration = 600;

const BASE_STEPS = 14;

// The criteria are written from the JD/intake + light web research; the platform
// saves the doc itself (one canonical qualification doc per project).
const TOOLS = ["calyflow_search_documents", "calyflow_read_document", "web_search"];

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
    primary.row.provider === "calyflow" &&
    platformGate.blocked &&
    platformGate.reason === "platform_credit"
  ) {
    return NextResponse.json({ error: platformGate.message }, { status: 402 });
  }

  let harness: string;
  try {
    harness = await loadQualificationHarness();
  } catch (err) {
    if (err instanceof HarnessNotProvisionedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Could not load the qualification configuration." },
      { status: 500 },
    );
  }

  const provider = env.mockAi ? "calyflow" : primary.row.provider;
  const model = env.mockAi ? "mock-model" : primary.model;

  const { data: run, error: runInsertError } = await db()
    .from("qualification_runs")
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
    console.error("Qualification: run insert failed", runInsertError);
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }
  const runId = run.id as string;

  let systemPrompt = harness;

  try {
    const assembled = await assembleContext(session.workspaceId, project, [], "");
    const block = contextBlock(assembled);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Qualification: context assembly failed:", err);
  }

  try {
    const prefs = await getUserPreferences(session.workspaceId, session.userId);
    const block = personalBlock(prefs);
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  } catch (err) {
    console.warn("Qualification: personal preferences load failed:", err);
  }

  systemPrompt = `${systemPrompt}\n\n${effortGuidance(effort)}`;

  const current = await getActiveQualification(session.workspaceId, projectId);
  let userPrompt: string;
  if (task) {
    userPrompt =
      `Revise the qualification criteria per this instruction:\n\n${task}\n\n` +
      "Return the COMPLETE revised criteria in markdown, preserving everything " +
      "not asked to change.";
    if (current?.extracted_text?.trim()) {
      userPrompt += `\n\n# Current criteria\n${current.extracted_text.trim()}`;
    }
  } else {
    userPrompt =
      "Draft the complete qualification criteria for this role, following your " +
      "output contract exactly.";
  }

  const priorMessages: { role: "user" | "assistant"; content: string }[] = [];
  if (continuingId) {
    const { data: prior } = await db()
      .from("qualification_runs")
      .select("task, output_text, created_at")
      .eq("project_id", projectId)
      .eq("conversation_id", conversationId)
      .neq("id", runId)
      .order("created_at", { ascending: true });
    for (const turn of prior ?? []) {
      priorMessages.push({
        role: "user",
        content: (turn.task as string | null)?.trim() || "(generate the criteria)",
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
          outputText =
            `# Qualification criteria: ${project.name} (mock)\n\n` +
            "**Mock run** (MOCK_AI=true): no provider or tools were called.";
          controller.enqueue(ndjson({ type: "text", value: outputText }));
          usage = { inputTokens: 500, outputTokens: 80, cachedInputTokens: 0 };
        } else {
          const lm = await getLanguageModel(
            primary.row.provider,
            primary.apiKey,
            model,
          );
          const tools = buildTools(ctx, TOOLS);
          const effectiveProvider =
            provider === "calyflow" ? env.platformProvider : provider;
          const tuning = effortModelTuning(effort, effectiveProvider, model);
          let streamError: unknown = null;
          const result = streamText({
            model: lm,
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(effortMaxSteps(BASE_STEPS, effort)),
            abortSignal: AbortSignal.timeout(540_000),
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
            cachedInputTokens: (totalUsage as { cachedInputTokens?: number })
              .cachedInputTokens,
          };

          // If research ate the step budget before the model wrote the criteria,
          // feed it back and force a tool-free write so they still get produced.
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
                  "You've gathered enough context. Now write the COMPLETE " +
                  "qualification criteria in markdown, following your output " +
                  "contract exactly. Do not call any tools — just produce the " +
                  "full criteria.",
                onDelta: (t) =>
                  controller.enqueue(ndjson({ type: "text", value: t })),
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
              console.warn("Qualification: finalize write failed:", err);
            }
          }
        }
      } catch (error) {
        failure =
          error instanceof Error ? error.message : "Qualification run failed";
      }

      const succeeded = failure === null;

      if (succeeded && !outputText.trim()) {
        outputText =
          finishReason === "tool-calls" || finishReason === "length"
            ? "I gathered the context but ran out of room before writing the criteria. Run me again — narrowing the request helps."
            : "I wasn't able to put together the criteria this time. Mind running it again, or rephrasing the request a little?";
        controller.enqueue(ndjson({ type: "text", value: outputText }));
      }

      let outputDocId: string | null = null;
      if (succeeded && outputText.trim()) {
        try {
          outputDocId = await saveQualification(
            session.workspaceId,
            projectId,
            session.userId,
            outputText,
          );
        } catch (err) {
          console.error("Qualification: save failed", err);
          failure = "The criteria were generated but couldn't be saved.";
        }
      }

      const costUsd = await computeCostUsd(provider, model, usage).catch(
        () => null,
      );

      const finalSucceeded = failure === null;
      await db()
        .from("qualification_runs")
        .update({
          status: finalSucceeded ? "succeeded" : "failed",
          steps,
          output_text: outputText || null,
          output_doc_id: outputDocId,
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

      if (!finalSucceeded) {
        controller.enqueue(ndjson({ type: "error", message: failure }));
      }
      controller.enqueue(
        ndjson({
          type: "done",
          runId,
          conversationId,
          outputDocId,
          succeeded: finalSucceeded,
        }),
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
