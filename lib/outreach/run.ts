import "server-only";
import { generateText, stepCountIs } from "ai";
import { db } from "../db";
import { env } from "../env";
import { computeCostUsd, getLanguageModel } from "../providers";
import { getUserPreferences } from "../queries";
import { assembleContext } from "../context";
import { contextBlock, personalBlock } from "../agents/prompt";
import { buildTools, type ToolContext } from "../agents/tools";
import {
  resolveConnectorTokens,
  resolveFirecrawlKey,
} from "../agents/connector-tokens";
import { listCandidates } from "../candidates/queries";
import { selectOutreachCandidates } from "./select";
import type { AgentRunStep, Candidate, Client, Project, Workspace } from "../types";

// Drafting tools: read the KB, optionally look up a public profile for a hook,
// and save a draft. NO email-send tools — the human sends from the UI.
const OUTREACH_TOOLS = [
  "calyflow_search_documents",
  "calyflow_read_document",
  "web_search",
  "web_scrape",
  "calyflow_save_outreach_draft",
];

export interface OutreachRunParams {
  workspace: Workspace;
  project: Project & { client: Client };
  userId: string;
  runId: string;
  provider: string;
  model: string;
  apiKey: string | null;
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

function rawStr(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The list of candidates the agent must draft for, with their identity + the
 *  details it can personalize from. The `id` is what the save tool needs. */
function candidatesBlock(cands: Candidate[]): string {
  if (cands.length === 0) {
    return (
      "# Candidates to draft for\nThere are no eligible candidates (none marked " +
      "accepted or qualified that have an email). Draft nothing and say so."
    );
  }
  const lines = cands.map((c) => {
    const raw = (c.raw ?? {}) as Record<string, unknown>;
    const bits: string[] = [];
    for (const k of ["title", "company", "location", "headline"]) {
      const v = rawStr(raw, k);
      if (v) bits.push(`${k}: ${v}`);
    }
    if (c.linkedin) bits.push(`linkedin: ${c.linkedin}`);
    const gh = rawStr(raw, "github_url") ?? rawStr(raw, "github");
    if (gh) bits.push(`github: ${gh}`);
    if (c.score != null) bits.push(`score: ${c.score}`);
    // A compact dump of any remaining raw fields, for richer personalization.
    const extra = JSON.stringify(raw);
    const extraStr = extra.length > 2 ? ` · details: ${extra.slice(0, 400)}` : "";
    return `- id: ${c.id} · ${c.name ?? "Unnamed"} <${c.email}>${
      bits.length ? ` · ${bits.join(" · ")}` : ""
    }${extraStr}`;
  });
  return (
    "# Candidates to draft for\nDraft one email for each candidate below. Pass " +
    "the `id` verbatim to calyflow_save_outreach_draft (the recipient is filled " +
    "from their stored email automatically).\n" +
    lines.join("\n")
  );
}

/**
 * Draft outreach emails headlessly for the project's eligible candidates. Built
 * to run inside `after()`: owns the lifecycle of an already-created
 * `outreach_runs` row (running → succeeded/failed), updating its step trace live
 * for the UI to poll. Writes drafts via calyflow_save_outreach_draft; never sends.
 */
export async function runOutreachDrafting(
  params: OutreachRunParams,
): Promise<void> {
  const { workspace, project, userId, runId, provider, model } = params;
  const workspaceId = workspace.id;
  const projectId = project.id;

  const steps: AgentRunStep[] = [];
  let outputText = "";
  let failure: string | null = null;
  let usage = {
    inputTokens: undefined as number | undefined,
    outputTokens: undefined as number | undefined,
    cachedInputTokens: undefined as number | undefined,
  };

  const ctx: ToolContext = {
    workspaceId,
    projectId,
    clientId: project.client.id,
    userId,
    ...(await resolveConnectorTokens(workspaceId, OUTREACH_TOOLS)),
    firecrawlKey: await resolveFirecrawlKey(workspaceId),
    createdDocIds: [],
    savedDraftIds: [],
  };

  try {
    const eligible = selectOutreachCandidates(await listCandidates(projectId));

    // System prompt: harness + project context (JD + KB) + recruiter/sender
    // details (signature) + the explicit candidate list to draft for.
    const { loadOutreachHarness } = await import("./harness");
    let systemPrompt = await loadOutreachHarness();

    try {
      const assembled = await assembleContext(workspaceId, project, [], "");
      const block = contextBlock(assembled);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch (err) {
      console.warn("Outreach: context assembly failed:", err);
    }

    try {
      const prefs = await getUserPreferences(workspaceId, userId);
      const block = personalBlock(prefs);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch (err) {
      console.warn("Outreach: personal preferences load failed:", err);
    }

    systemPrompt = `${systemPrompt}\n\n${candidatesBlock(eligible)}`;

    const userPrompt =
      "Draft a personalized outreach email for each candidate in '# Candidates " +
      "to draft for', following your harness. Save each with " +
      "calyflow_save_outreach_draft, then give a one-line summary.";

    if (env.mockAi) {
      outputText = "**Mock outreach run** (MOCK_AI=true): no tools were called.";
      usage = { inputTokens: 500, outputTokens: 60, cachedInputTokens: 0 };
    } else {
      const lm = await getLanguageModel(provider, params.apiKey ?? "", model);
      const tools = buildTools(ctx, OUTREACH_TOOLS);
      // ~2-3 steps per candidate (optional lookup + save); bounded.
      const stepCap = Math.min(80, Math.max(16, eligible.length * 3));

      const result = await generateText({
        model: lm,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools,
        stopWhen: stepCountIs(stepCap),
        abortSignal: AbortSignal.timeout(540_000),
        onStepFinish: async ({ toolCalls, toolResults }) => {
          for (const call of toolCalls ?? []) {
            steps.push({
              type: "tool-call",
              tool: call.toolName,
              summary: summarize(call.input),
            });
          }
          for (const res of toolResults ?? []) {
            steps.push({
              type: "tool-result",
              tool: res.toolName,
              summary: summarize(res.output),
            });
          }
          await db()
            .from("outreach_runs")
            .update({ steps })
            .eq("id", runId)
            .then(undefined, () => {});
        },
      });
      outputText = result.text;
      const total = result.totalUsage;
      usage = {
        inputTokens: total.inputTokens,
        outputTokens: total.outputTokens,
        cachedInputTokens: (total as { cachedInputTokens?: number })
          .cachedInputTokens,
      };
    }
  } catch (error) {
    failure =
      error instanceof Error ? error.message : "Outreach drafting run failed";
  }

  const succeeded = failure === null;
  const costUsd = await computeCostUsd(provider, model, usage).catch(() => null);
  const draftsCreated = ctx.savedDraftIds?.length ?? 0;

  await db()
    .from("outreach_runs")
    .update({
      status: succeeded ? "succeeded" : "failed",
      steps,
      output_text: outputText || null,
      error_message: failure ? failure.slice(0, 500) : null,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      cache_read_tokens: usage.cachedInputTokens ?? null,
      cost_usd: costUsd,
      drafts_created: draftsCreated,
    })
    .eq("id", runId);

  if (provider === "calyflow" && costUsd) {
    await db().rpc("increment_platform_spent", {
      p_workspace_id: workspaceId,
      p_amount: costUsd,
    });
  }
}
