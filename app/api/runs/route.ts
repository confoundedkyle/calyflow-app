import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assembleContext, renderPrompt } from "@/lib/context";
import { checkBudgets } from "@/lib/budgets";
import {
  computeCostUsd,
  getLanguageModel,
  providerLabel,
  resolveRunProviders,
  type ResolvedProvider,
} from "@/lib/providers";
import { preflightWorkflow } from "@/lib/readiness";
import {
  getDocument,
  getProject,
  getWorkspaceWorkflow,
  listDocuments,
} from "@/lib/queries";
import { getPostHogClient } from "@/lib/posthog-server";
import type { Doc } from "@/lib/types";

export const maxDuration = 600; // sync + streaming; Cloud Run holds the line

interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const projectId = String(body?.projectId ?? "");
  const workflowId = String(body?.workflowId ?? "");
  const inputDocIds: string[] = Array.isArray(body?.inputDocIds)
    ? body.inputDocIds.map(String)
    : [];
  const inputText = typeof body?.inputText === "string" ? body.inputText : "";

  const [project, workflow] = await Promise.all([
    getProject(session.workspaceId, projectId),
    getWorkspaceWorkflow(session.workspaceId, workflowId),
  ]);
  if (!project || !workflow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (workflow.archived_at) {
    return NextResponse.json(
      { error: "This workflow is archived. Restore it from Workflows & agents." },
      { status: 400 },
    );
  }
  if (project.status !== "active") {
    return NextResponse.json(
      { error: "This project is archived" },
      { status: 400 },
    );
  }

  // Selected inputs must be files of THIS project (scoped lookups only).
  const inputDocs: Doc[] = [];
  for (const id of inputDocIds) {
    const doc = await getDocument(session.workspaceId, id);
    if (!doc || doc.scope_type !== "project" || doc.scope_id !== projectId) {
      return NextResponse.json({ error: "Invalid input doc" }, { status: 400 });
    }
    inputDocs.push(doc);
  }

  // Preconditions before spending tokens (SPEC §5).
  const projectDocs = await listDocuments(
    session.workspaceId,
    "project",
    projectId,
    "file",
  );
  const preflight = preflightWorkflow(
    workflow.library?.input_spec ?? null,
    projectDocs,
  );
  if (!preflight.ready) {
    return NextResponse.json(
      { error: preflight.missing.join(" · ") },
      { status: 400 },
    );
  }
  // Typed run notes stand in for an input doc — text-only runs are fine.
  if (preflight.needsInputPicker && inputDocs.length === 0 && !inputText.trim()) {
    return NextResponse.json(
      { error: "Type some context or attach at least one file" },
      { status: 400 },
    );
  }

  // Resolve provider chain; drop 'calyflow' when the platform credit is
  // spent (a BYO fallback instantly unblocks — SPEC §10).
  const contextNotes: string[] = [];
  let chain: ResolvedProvider[];
  let unreadableKeys: string[] = [];
  if (env.mockAi) {
    chain = mockChain();
  } else {
    const resolved = await resolveRunProviders(session.workspaceId);
    chain = resolved.providers;
    unreadableKeys = resolved.unreadableKeys;
  }
  // A saved key that won't decrypt was skipped above. If the run still has a
  // working provider, note it; otherwise it becomes the failure reason below.
  const unreadableMessage =
    unreadableKeys.length > 0
      ? `Your saved ${formatProviderList(unreadableKeys)} API key couldn't be read — it was likely encrypted with a different key. Re-save it in Settings → AI Providers.`
      : null;
  if (unreadableMessage && chain.length > 0) {
    contextNotes.push(unreadableMessage);
  }
  const platformGate = await checkBudgets(session.workspace, "calyflow");
  if (platformGate.blocked && platformGate.reason === "platform_credit") {
    if (chain.some((p) => p.row.provider === "calyflow")) {
      chain = chain.filter((p) => p.row.provider !== "calyflow");
      contextNotes.push(
        "Calyflow default skipped: included platform credit is used up.",
      );
    }
  }
  const spendGate = await checkBudgets(session.workspace, "byo");
  if (spendGate.blocked && spendGate.reason === "spend_limit") {
    return NextResponse.json({ error: spendGate.message }, { status: 402 });
  }
  if (chain.length === 0) {
    return NextResponse.json(
      {
        error:
          unreadableMessage ??
          (platformGate.blocked && platformGate.reason === "platform_credit"
            ? platformGate.message
            : "No AI provider configured. Add one in Settings → AI Providers."),
      },
      { status: 402 },
    );
  }

  const context = await assembleContext(
    session.workspaceId,
    project,
    inputDocs,
    inputText,
  );
  contextNotes.push(...context.notes);
  const renderedPrompt = renderPrompt(workflow.prompt_template, context);

  const { data: run, error: runInsertError } = await db()
    .from("workflow_runs")
    .insert({
      project_id: projectId,
      workspace_workflow_id: workflowId,
      status: "running",
      input_doc_ids: inputDocIds,
      input_text: inputText.trim() || null,
      rendered_prompt: renderedPrompt,
      context_notes: contextNotes,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (runInsertError) {
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }
  const runId = run.id as string;

  getPostHogClient().capture({
    distinctId: session.userId,
    event: "workflow_run_started",
    properties: {
      run_id: runId,
      workflow_id: workflowId,
      workflow_name: workflow.name,
      project_id: projectId,
      workspace_id: session.workspaceId,
      has_input_docs: inputDocIds.length > 0,
      has_input_text: !!inputText.trim(),
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let served: ResolvedProvider | null = null;
      let fallbackUsed = false;
      let usage: RunUsage = {};
      let lastError: unknown = null;

      for (let attempt = 0; attempt < chain.length; attempt++) {
        const candidate = chain[attempt];
        try {
          if (env.mockAi) {
            served = candidate;
            fallbackUsed = attempt > 0;
            for (const chunk of mockResponse(workflow.name)) {
              text += chunk;
              controller.enqueue(encoder.encode(chunk));
              await new Promise((resolve) => setTimeout(resolve, 15));
            }
            usage = { inputTokens: 1200, outputTokens: 340 };
            break;
          }
          const model = await getLanguageModel(
            candidate.row.provider,
            candidate.apiKey,
            candidate.model,
          );
          // streamText swallows provider errors (401, bad model, …) into a
          // generic "No output generated" unless we capture them via onError.
          let streamError: unknown = null;
          const result = streamText({
            model,
            prompt: renderedPrompt,
            abortSignal: AbortSignal.timeout(150_000),
            onError: ({ error }) => {
              streamError = error;
            },
          });
          for await (const chunk of result.textStream) {
            served = candidate;
            fallbackUsed = attempt > 0;
            text += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          // Surface the real provider error so it's recorded and (if a fallback
          // exists) we advance to the next provider in the catch below.
          if (streamError) throw streamError;
          served = candidate;
          fallbackUsed = attempt > 0;
          const finalUsage = await result.usage;
          usage = {
            inputTokens: finalUsage.inputTokens,
            outputTokens: finalUsage.outputTokens,
            cachedInputTokens: (finalUsage as { cachedInputTokens?: number })
              .cachedInputTokens,
          };
          break;
        } catch (error) {
          lastError = error;
          // 429 / 5xx / timeout before any text → advance to next provider
          // (SPEC §10). A failure mid-stream is a failed run.
          if (text.length === 0 && attempt < chain.length - 1) {
            continue;
          }
          break;
        }
      }

      const succeeded = served !== null && lastError === null;
      const costUsd = served
        ? await computeCostUsd(served.row.provider, served.model, usage).catch(
            () => null,
          )
        : null;

      await db()
        .from("workflow_runs")
        .update({
          status: succeeded ? "succeeded" : "failed",
          provider: served?.row.provider ?? chain[chain.length - 1]?.row.provider,
          model: served?.model ?? chain[chain.length - 1]?.model,
          fallback_used: fallbackUsed,
          model_response: text || null,
          error_message: succeeded
            ? null
            : lastError instanceof Error
              ? lastError.message.slice(0, 500)
              : "Run failed",
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          cache_read_tokens: usage.cachedInputTokens ?? null,
          cost_usd: costUsd,
        })
        .eq("id", runId);

      if (succeeded && text) {
        const { data: outputDoc } = await db()
          .from("documents")
          .insert({
            scope_type: "project",
            scope_id: projectId,
            workspace_id: session.workspaceId,
            kind: "file",
            doc_type: "output",
            source: "workflow",
            filename: `${workflow.name} — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
            extracted_text: text,
            created_by: session.userId,
          })
          .select("id")
          .single();
        if (outputDoc) {
          await db()
            .from("workflow_runs")
            .update({ output_doc_id: outputDoc.id })
            .eq("id", runId);
        }
      }
      if (served?.row.provider === "calyflow" && costUsd) {
        await db().rpc("increment_platform_spent", {
          p_workspace_id: session.workspaceId,
          p_amount: costUsd,
        });
      }

      getPostHogClient().capture({
        distinctId: session.userId,
        event: "workflow_run_completed",
        properties: {
          run_id: runId,
          workflow_id: workflowId,
          workflow_name: workflow.name,
          project_id: projectId,
          workspace_id: session.workspaceId,
          succeeded,
          provider: served?.row.provider ?? null,
          model: served?.model ?? null,
          fallback_used: fallbackUsed,
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          cost_usd: costUsd,
        },
      });

      if (!succeeded) {
        const message =
          lastError instanceof Error ? lastError.message : "Run failed";
        controller.enqueue(encoder.encode(`\n\n⚠️ Run failed: ${message}`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Run-Id": runId,
    },
  });
}

function mockChain(): ResolvedProvider[] {
  return [
    {
      row: {
        id: "mock",
        workspace_id: "mock",
        provider: "calyflow",
        api_key_cipher: null,
        key_last4: null,
        default_model: "mock-model",
        priority: 1,
        status: "valid",
        last_validated_at: null,
      },
      apiKey: "mock",
      model: "mock-model",
    },
  ];
}

/** "OpenAI", "OpenAI and Anthropic", "OpenAI, Anthropic and Google" */
function formatProviderList(providers: string[]): string {
  const labels = providers.map(providerLabel);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function mockResponse(workflowName: string): string[] {
  const text = `# ${workflowName} — mock output\n\n**This is a mocked run** (MOCK_AI=true): no provider was called.\n\n## Verdict\n**Fit score:** 8/10 — Strong fit\nCandidate shows direct evidence for most must-haves; two areas need probing on the screening call.\n\n## Must-have requirements\n| Requirement | Evidence from CV | Met? |\n|---|---|---|\n| Kubernetes in production | "Operated 40-node EKS clusters" | ✅ |\n| CI/CD ownership | "Built GitLab CI pipelines from scratch" | ✅ |\n| Terraform | not evident from CV | ⚠️ |\n\n## Strengths\n- Owned production infrastructure end to end\n- Clear progression across last two roles\n\n## Red flags & gaps\n- Terraform not evident from CV\n\n## Questions for the screening call\n1. Walk me through your largest Kubernetes incident.\n2. What IaC tooling have you used, and at what depth?\n`;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 80) chunks.push(text.slice(i, i + 80));
  return chunks;
}
