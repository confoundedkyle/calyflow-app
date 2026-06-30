import "server-only";
import {
  generateText,
  stepCountIs,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from "ai";
import { db } from "../db";
import { env } from "../env";
import {
  computeCostUsd,
  getLanguageModel,
  reasoningSettings,
} from "../providers";
import { connectorLabel, effectiveConnectorCaps } from "../connectors";
import {
  getActiveSourcingPlan,
  getUserPreferences,
  listConnections,
} from "../queries";
import { connectedProvidersFrom } from "../run-items";
import { assembleContext } from "../context";
import { contextBlock, personalBlock } from "../agents/prompt";
import {
  buildTools,
  SOURCING_AGENT_TOOLS,
  type ToolContext,
} from "../agents/tools";
import {
  resolveConnectorTokens,
  resolveFirecrawlKey,
} from "../agents/connector-tokens";
import {
  countQualified,
  listCandidates,
  listCandidatesCompact,
  listCandidateFeedback,
} from "../candidates/queries";
import { formatFeedbackBlock } from "../candidates/feedback";
import {
  connectorSpendByProvider,
  recordConnectorCreditUsage,
} from "./spend";
import { appendProgressEntry } from "../sourcing-plan/progress";
import type {
  AgentRunStep,
  Candidate,
  Client,
  Project,
  Workspace,
} from "../types";

// A single Continue/Start sourcing run can chase the goal across many tool
// calls, so give it generous headroom; the goal and budget gates stop it sooner.
const STEP_CAP = 80;
// A run is two phases sharing one step/budget pool: FIND (breadth) sources
// widely, then VERIFY (depth) enriches and re-scores the best finds. Reserve a
// slice of the pool for FIND so VERIFY always has resources left.
const FIND_STEP_FRACTION = 0.6;
const FIND_BUDGET_FRACTION = 0.6;

// The continuation nudge for the FIND phase: act, don't narrate; keep sourcing.
const FIND_NUDGE =
  "Keep going — you have NOT reached the qualified goal and still have budget " +
  "and steps. Do NOT write a plan, a status update, or a summary now: your next " +
  "output must be tool calls, not prose. Run the next wave immediately — " +
  "title/stack/location variants and channels you haven't tried yet " +
  "(GitHub-via-web, Stack Overflow, target-company team pages) — and save every " +
  "scored candidate (partial snippet evidence is enough). Don't re-source anyone " +
  "already saved. Only finish when the goal is met or you have truly exhausted " +
  "distinct angles.";

// The continuation nudge for the VERIFY phase: keep enriching, don't widen.
const VERIFY_NUDGE =
  "Keep verifying — do NOT add new names. Continue enriching and re-scoring the " +
  "remaining candidates from the list with real evidence (web_scrape their " +
  "GitHub/personal site, targeted searches per unverified criterion), then " +
  "re-save each with calyflow_save_candidate. Your next output must be tool " +
  "calls, not prose.";

/** One compact line describing a saved candidate, for the verify/diagnosis
 *  prompts: name · title · company · location — score — best profile URL. */
function candidateLine(c: Candidate): string {
  const raw = (c.raw ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof raw[k] === "string" ? (raw[k] as string) : undefined;
  const url =
    c.linkedin ||
    str("github") ||
    str("github_url") ||
    str("portfolio") ||
    str("url") ||
    "";
  const bits = [c.name ?? "Unnamed", str("title"), str("company"), str("location")]
    .filter(Boolean)
    .join(" · ");
  return `- ${bits} — score ${c.score ?? "?"}${url ? ` — ${url}` : ""}`;
}

/** VERIFY-phase opening prompt: enrich + re-score the top saved finds, no new
 *  names. */
function verifyPromptFor(top: Candidate[], goal: number | null): string {
  return (
    "VERIFY MODE. Do NOT search for or add any NEW names. Your job now is to " +
    "VERIFY and re-score the most promising candidates already saved, with real " +
    "evidence, against the qualification criteria.\n\n" +
    "For EACH candidate below: gather evidence on the criteria you couldn't see " +
    "from the snippet — web_scrape their GitHub / personal site / Stack Overflow " +
    'profile, and run targeted web_search queries pairing their name with each ' +
    'UNVERIFIED criterion (e.g. "<name> Databricks", "<name> FastAPI Celery"). ' +
    "Then re-save them with calyflow_save_candidate (same name/linkedin so it " +
    "updates in place): an updated score, an evidence-cited rationale, and " +
    "qualified set HONESTLY from what the evidence actually shows. Never invent " +
    "experience the source doesn't show.\n\n" +
    `Top saved candidates to verify (goal: ${goal ?? "?"} qualified):\n` +
    top.map(candidateLine).join("\n")
  );
}

/** DIAGNOSE-phase prompt (tool-free): the structured escalation when a run ends
 *  short of the qualified goal. Diagnose & recommend only — never auto-qualify. */
function diagnosisPromptFor(
  top: Candidate[],
  qualifiedNow: number,
  goal: number | null,
): string {
  return (
    "The run is ending below the qualified goal " +
    `(${qualifiedNow} qualified of ${goal ?? "?"}). Do NOT call any tools now — ` +
    "write your final STRUCTURED DIAGNOSIS as plain text, per your harness:\n" +
    "1. Binding knock-out — the single criterion blocking the most otherwise-" +
    "strong candidates.\n" +
    "2. Near-miss count — how many candidates met everything EXCEPT that one.\n" +
    "3. A specific recommended relaxation (e.g. move X from knock-out to a " +
    "weighted criterion) and roughly how many would then qualify.\n" +
    "4. The ranked best candidates for the recruiter to review — one line each " +
    "with the evidence.\n" +
    "Do NOT mark anyone qualified or relax the rubric yourself — only recommend.\n\n" +
    "Top saved candidates (scored):\n" +
    top.map(candidateLine).join("\n")
  );
}

export interface ShortlistRunParams {
  workspace: Workspace;
  project: Project & { client: Client };
  userId: string;
  runId: string;
  provider: string;
  model: string;
  apiKey: string | null;
  goalQualified: number | null;
  budgetUsd: number | null;
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

function connectorsBlock(providers: string[]): string {
  if (providers.length === 0) {
    return (
      "# Active connectors\nThis workspace has no data-source connectors " +
      "connected. Use the no-connector tools you have (web search/scrape, GitHub, " +
      "and any platform-keyed sources) and call out where connecting a sourcing " +
      "tool would unlock more reach."
    );
  }
  const lines = providers.map((p) => `- ${connectorLabel(p)}`).join("\n");
  return (
    "# Active connectors\nPrioritise these connected data sources you can " +
    "actually query:\n" +
    lines
  );
}

/** A status block so a resumed run continues toward the goal instead of starting
 *  over: how many candidates exist, how many qualified vs the goal, spend so far. */
function statusBlock(
  totalCandidates: number,
  qualified: number,
  goal: number | null,
  spentUsd: number,
  budgetUsd: number | null,
): string {
  const lines = [
    `- Candidates already in the shortlist: ${totalCandidates}`,
    `- Qualified so far: ${qualified}${goal ? ` (goal: ${goal})` : ""}`,
  ];
  if (budgetUsd != null) {
    lines.push(
      `- Budget spent: $${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}`,
    );
  }
  // When prior runs found plenty of people but none qualified, the gap is
  // verification, not reach — steer this run toward depth from the start.
  if (totalCandidates >= 5 && qualified === 0) {
    lines.push(
      "- NOTE: prior runs found people but NONE qualified. The gap is " +
        "verification, not reach. Prioritise enriching and re-scoring the top " +
        "saved prospects (web_scrape their GitHub/personal site, targeted " +
        "searches per unverified criterion) over finding more new names — and if " +
        "the rubric is genuinely unreachable, diagnose the binding knock-out.",
    );
  }
  return (
    "# Shortlist status\nContinue from where the last run left off — do NOT " +
    "re-source people already saved (use calyflow_list_candidates to check). " +
    "Keep sourcing and scoring until the qualified goal is met.\n" +
    lines.join("\n")
  );
}

/** Sum of cost_usd across this project's prior shortlist runs (budget tracking). */
async function priorSpendUsd(projectId: string): Promise<number> {
  const { data } = await db()
    .from("shortlist_runs")
    .select("cost_usd")
    .eq("project_id", projectId);
  return (data ?? []).reduce(
    (sum, r) => sum + Number((r as { cost_usd: number | null }).cost_usd ?? 0),
    0,
  );
}

/**
 * Run the main Sourcing Agent headlessly toward the project's goal/budget. Built
 * to run inside `after()`: it owns the full lifecycle of an already-created
 * `shortlist_runs` row (status running → succeeded/failed), updating its step
 * trace live for the UI to poll, and appends a one-line progress entry to the
 * Sourcing Plan when done.
 */
export async function runShortlistSourcing(
  params: ShortlistRunParams,
): Promise<void> {
  const { workspace, project, userId, runId, provider, model, goalQualified } =
    params;
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

  // Per-connector spend caps: the effective cap (project budget or sensible
  // default) minus what's already been spent. A metered tool clamps to `remaining`.
  const priorConnectorSpend = await connectorSpendByProvider(projectId);
  const creditCaps = effectiveConnectorCaps(
    project.sourcing_connector_budgets ?? {},
    priorConnectorSpend,
  );

  const ctx: ToolContext = {
    workspaceId,
    projectId,
    clientId: project.client.id,
    userId,
    ...(await resolveConnectorTokens(workspaceId, SOURCING_AGENT_TOOLS)),
    firecrawlKey: await resolveFirecrawlKey(workspaceId),
    createdDocIds: [],
    savedCandidateIds: [],
    creditCaps,
    recordCreditUsage: (prov, credits, detail) =>
      recordConnectorCreditUsage({
        workspaceId,
        projectId,
        shortlistRunId: runId,
        provider: prov,
        credits,
        detail,
      }),
  };

  try {
    // Build the system prompt: harness + connectors + project context (auto-
    // includes the active Sourcing Plan AND Qualification criteria) + personal +
    // a live status block for resuming.
    const { loadShortlistHarness } = await import("./harness");
    let systemPrompt = await loadShortlistHarness();

    try {
      const connections = await listConnections(workspaceId);
      const providers = [...connectedProvidersFrom(connections)];
      systemPrompt = `${systemPrompt}\n\n${connectorsBlock(providers)}`;
    } catch (err) {
      console.warn("Shortlist: connectors block failed:", err);
    }

    try {
      const assembled = await assembleContext(workspaceId, project, [], "");
      const block = contextBlock(assembled);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch (err) {
      console.warn("Shortlist: context assembly failed:", err);
    }

    try {
      const prefs = await getUserPreferences(workspaceId, userId);
      const block = personalBlock(prefs);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch (err) {
      console.warn("Shortlist: personal preferences load failed:", err);
    }

    const [qualifiedBefore, compact, spent] = await Promise.all([
      countQualified(projectId),
      listCandidatesCompact(projectId, 1),
      priorSpendUsd(projectId),
    ]);
    systemPrompt = `${systemPrompt}\n\n${statusBlock(
      compact.length,
      qualifiedBefore,
      goalQualified,
      spent,
      params.budgetUsd,
    )}`;

    // Recruiter fit feedback from earlier reviews — calibrate to it.
    try {
      const fb = await listCandidateFeedback(projectId);
      const block = formatFeedbackBlock(fb.accepted, fb.rejected);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch (err) {
      console.warn("Shortlist: feedback block failed:", err);
    }

    const userPrompt =
      "Source candidates for this project following your harness. Save each one " +
      "with calyflow_save_candidate (scored 0-100 against the qualification " +
      "criteria; partial evidence from a search snippet is enough to save). Keep " +
      "running fresh waves — new title/stack/location variants and new channels — " +
      "until the qualified goal is reached or you have genuinely exhausted the " +
      "distinct angles. Do NOT stop after one wave to say 'more waves are needed' " +
      "— run those waves now.";

    if (env.mockAi) {
      outputText = "**Mock shortlist run** (MOCK_AI=true): no tools were called.";
      usage = { inputTokens: 500, outputTokens: 60, cachedInputTokens: 0 };
    } else {
      const lm = await getLanguageModel(provider, params.apiKey ?? "", model);
      const tools = buildTools(ctx, SOURCING_AGENT_TOOLS);

      // Surface the model's reasoning so the trace reads Thought → Action →
      // Observation. Provider-agnostic: this picks the right knob for whatever
      // model the run uses (and is a no-op for models that don't reason). When
      // reasoning IS enabled we must NOT force a tool call on step 0 — Anthropic
      // rejects forced tool_choice while extended thinking is on, and a genuine
      // "Thought" already replaces the planning-essay we were guarding against.
      const reasoning = reasoningSettings(provider, model);
      const reasoningOn = reasoning.providerOptions != null;

      // Stop when the project hits its qualified goal (total, so resumes count
      // earlier runs). `isGoalMet` is the plain predicate; `goalReached` wraps it
      // as a per-step StopCondition for generateText.
      const isGoalMet = async (): Promise<boolean> => {
        if (!goalQualified || goalQualified <= 0) return false;
        return (await countQualified(projectId)) >= goalQualified;
      };
      const goalReached: StopCondition<ToolSet> = () => isGoalMet();

      // Fetch the model's pricing ONCE so the budget guards estimate spend without
      // a DB round-trip on every step. Falls back to "no estimate" (cost 0 → no
      // in-step cap) if pricing is unknown; the phase ceilings still bound the run.
      const catalogProvider =
        provider === "calyflow" ? env.platformProvider : provider;
      const { data: priceRow } = await db()
        .from("model_catalog")
        .select("pricing")
        .eq("provider", catalogProvider)
        .eq("model_id", model)
        .maybeSingle();
      const pricing = (priceRow?.pricing ?? null) as {
        input?: number;
        output?: number;
        cache_read?: number;
      } | null;
      const estimateCost = (u: {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
      }): number => {
        if (!pricing?.input || !pricing?.output) return 0;
        const cached = u.cachedInputTokens ?? 0;
        const uncached = Math.max((u.inputTokens ?? 0) - cached, 0);
        return (
          (uncached * pricing.input +
            (u.outputTokens ?? 0) * pricing.output +
            cached * (pricing.cache_read ?? pricing.input)) /
          1_000_000
        );
      };

      // Keep the whole run inside the 600s function budget, leaving headroom for
      // the final status/cost/progress-log writes after it.
      const MAX_ROUNDS = 8;
      const deadline = Date.now() + 555_000;
      let stepsUsed = 0;
      let spentThisRun = 0;
      const agg = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

      const addUsage = (u: {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
      }): void => {
        agg.inputTokens += u.inputTokens ?? 0;
        agg.outputTokens += u.outputTokens ?? 0;
        agg.cachedInputTokens += u.cachedInputTokens ?? 0;
        spentThisRun += estimateCost(u);
      };

      // Hard budget cap WITHIN a round, against a phase ceiling: stop the agent
      // the moment cumulative spend reaches the ceiling, so a long round can't
      // overshoot before the between-round check.
      const makeBudgetStop =
        (ceiling: number | null): StopCondition<ToolSet> =>
        ({ steps: callSteps }) => {
          if (ceiling == null || ceiling <= 0) return false;
          let inputTokens = 0;
          let outputTokens = 0;
          let cachedInputTokens = 0;
          for (const s of callSteps) {
            inputTokens += s.usage?.inputTokens ?? 0;
            outputTokens += s.usage?.outputTokens ?? 0;
            cachedInputTokens +=
              (s.usage as { cachedInputTokens?: number })?.cachedInputTokens ??
              0;
          }
          return (
            spent +
              spentThisRun +
              estimateCost({ inputTokens, outputTokens, cachedInputTokens }) >=
            ceiling
          );
        };

      const hasResources = (budgetCeiling: number | null): boolean =>
        stepsUsed < STEP_CAP &&
        deadline - Date.now() > 20_000 &&
        (budgetCeiling == null || spent + spentThisRun < budgetCeiling);

      // One phase = the multi-round continuation loop, bounded by a step + budget
      // ceiling. `prepareStep` forces a tool call on step 0 so a round always acts
      // (never opens with a planning essay); we only conclude "exhausted" after
      // two consecutive rounds that add nobody new — one dry wave isn't proof the
      // angle is tapped out.
      const runPhase = async (opts: {
        initialMessages: ModelMessage[];
        continuationNudge: string;
        stepCeiling: number;
        budgetCeiling: number | null;
      }): Promise<void> => {
        const budgetStop = makeBudgetStop(opts.budgetCeiling);
        let messages = opts.initialMessages;
        let dryRounds = 0;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          if (await isGoalMet()) break;
          if (stepsUsed >= opts.stepCeiling) break;
          if (
            opts.budgetCeiling != null &&
            spent + spentThisRun >= opts.budgetCeiling
          )
            break;
          const remainingMs = deadline - Date.now();
          if (remainingMs < 20_000) break; // not enough time for another wave

          const savedBefore = ctx.savedCandidateIds?.length ?? 0;
          const result = await generateText({
            model: lm,
            system: systemPrompt,
            messages,
            tools,
            ...reasoning,
            stopWhen: [
              stepCountIs(opts.stepCeiling - stepsUsed),
              goalReached,
              budgetStop,
            ],
            // Force the round to ACT first — never let it open with a planning
            // essay and stop. Step 0 must be a tool call; later steps are free.
            // With reasoning on, the model thinks first by design (and the
            // provider may reject a forced tool call), so leave step 0 free.
            prepareStep: ({ stepNumber }) =>
              stepNumber === 0 && !reasoningOn
                ? { toolChoice: "required" }
                : undefined,
            abortSignal: AbortSignal.timeout(Math.min(540_000, remainingMs)),
            onStepFinish: async ({ toolCalls, toolResults, reasoningText }) => {
              // Record the "Thought" before its action so the trace stays
              // Thought → Action → Observation.
              if (reasoningText?.trim()) {
                steps.push({
                  type: "reasoning",
                  tool: "",
                  summary: summarize(reasoningText),
                });
              }
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
              // Persist the growing trace so the UI poll shows live progress.
              await db()
                .from("shortlist_runs")
                .update({ steps })
                .eq("id", runId)
                .then(undefined, () => {});
            },
          });

          outputText = result.text || outputText;
          stepsUsed += result.steps.length;
          addUsage({
            inputTokens: result.totalUsage.inputTokens,
            outputTokens: result.totalUsage.outputTokens,
            cachedInputTokens: (
              result.totalUsage as { cachedInputTokens?: number }
            ).cachedInputTokens,
          });

          if (await isGoalMet()) break;
          const addedThisRound =
            (ctx.savedCandidateIds?.length ?? 0) - savedBefore;
          dryRounds = addedThisRound === 0 ? dryRounds + 1 : 0;
          if (dryRounds >= 2) break;

          // Goal unmet — carry the full context (tool calls and all) forward and
          // push another wave. Be blunt: act, don't narrate.
          messages = [
            ...messages,
            ...result.response.messages,
            { role: "user", content: opts.continuationNudge },
          ];
        }
      };

      // ---- Phase 1: FIND (breadth) — reserve part of the pool for VERIFY ----
      const findBudgetCeiling =
        params.budgetUsd != null
          ? params.budgetUsd * FIND_BUDGET_FRACTION
          : null;
      await runPhase({
        initialMessages: [{ role: "user", content: userPrompt }],
        continuationNudge: FIND_NUDGE,
        stepCeiling: Math.round(STEP_CAP * FIND_STEP_FRACTION),
        budgetCeiling: findBudgetCeiling,
      });

      // ---- Phase 2: VERIFY (depth) — enrich + re-score the top saved finds ----
      const verifyK = Math.min(Math.max((goalQualified ?? 5) * 3, 5), 15);
      if (!(await isGoalMet()) && hasResources(params.budgetUsd)) {
        const top = (await listCandidates(projectId).catch(() => [])).slice(
          0,
          verifyK,
        );
        if (top.length > 0) {
          await runPhase({
            initialMessages: [
              { role: "user", content: verifyPromptFor(top, goalQualified) },
            ],
            continuationNudge: VERIFY_NUDGE,
            stepCeiling: STEP_CAP,
            budgetCeiling: params.budgetUsd,
          });
        }
      }

      // ---- Phase 3: DIAGNOSE — structured escalation when short of goal ----
      if (!(await isGoalMet()) && hasResources(params.budgetUsd)) {
        try {
          const [top, qualifiedNow] = await Promise.all([
            listCandidates(projectId)
              .then((c) => c.slice(0, verifyK))
              .catch(() => [] as Candidate[]),
            countQualified(projectId).catch(() => 0),
          ]);
          const diag = await generateText({
            model: lm,
            system: systemPrompt,
            ...reasoning,
            messages: [
              {
                role: "user",
                content: diagnosisPromptFor(top, qualifiedNow, goalQualified),
              },
            ],
            abortSignal: AbortSignal.timeout(
              Math.min(120_000, Math.max(15_000, deadline - Date.now())),
            ),
          });
          if (diag.text) outputText = diag.text;
          addUsage({
            inputTokens: diag.totalUsage.inputTokens,
            outputTokens: diag.totalUsage.outputTokens,
            cachedInputTokens: (diag.totalUsage as { cachedInputTokens?: number })
              .cachedInputTokens,
          });
        } catch (err) {
          console.warn("Shortlist: diagnosis step failed:", err);
        }
      }

      usage = {
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        cachedInputTokens: agg.cachedInputTokens,
      };
    }
  } catch (error) {
    failure =
      error instanceof Error ? error.message : "Shortlist sourcing run failed";
  }

  const succeeded = failure === null;
  const costUsd = await computeCostUsd(provider, model, usage).catch(() => null);
  const qualifiedAfter = await countQualified(projectId).catch(() => null);
  const candidatesAdded = ctx.savedCandidateIds?.length ?? 0;

  await db()
    .from("shortlist_runs")
    .update({
      status: succeeded ? "succeeded" : "failed",
      steps,
      output_text: outputText || null,
      error_message: failure ? failure.slice(0, 500) : null,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      cache_read_tokens: usage.cachedInputTokens ?? null,
      cost_usd: costUsd,
      candidates_added: candidatesAdded,
      qualified_after: qualifiedAfter,
    })
    .eq("id", runId);

  if (provider === "calyflow" && costUsd) {
    await db().rpc("increment_platform_spent", {
      p_workspace_id: workspaceId,
      p_amount: costUsd,
    });
  }

  // Append a one-line progress entry to the Sourcing Plan so the trail is
  // visible there too and the next run sees it.
  if (succeeded && candidatesAdded > 0) {
    try {
      const plan = await getActiveSourcingPlan(workspaceId, projectId);
      if (plan) {
        const dateLabel = new Date().toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const note =
          `Sourcing run: saved ${candidatesAdded} candidate(s), ` +
          `${qualifiedAfter ?? "?"} qualified in total` +
          (goalQualified ? ` (goal ${goalQualified})` : "") +
          ".";
        const updated = appendProgressEntry(
          plan.extracted_text ?? "",
          dateLabel,
          note,
        );
        await db()
          .from("documents")
          .update({ extracted_text: updated })
          .eq("id", plan.id);
      }
    } catch (err) {
      console.warn("Shortlist: progress-log append failed:", err);
    }
  }
}
