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
import { getValidAccessToken } from "@/lib/integrations";
import {
  CONNECTOR_CATEGORY_LABELS,
  CONNECTOR_REQUIREMENT_PREFIX,
  connectorLabel,
  connectorsForCategory,
  providerToolPrefix,
  requiredConnectorCategories,
} from "@/lib/connectors";
import { assembleContext, type AssembledContext } from "@/lib/context";
import { ALL_TOOL_NAMES, buildTools, type ToolContext } from "@/lib/agents/tools";
import type { AgentRunStep, UserPreferences } from "@/lib/types";

export const maxDuration = 600; // multi-step tool loops can run long

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

/** Folds assembled project/KB context into a system-prompt block so the agent
 *  starts with full context (the JD, scorecards, notes) instead of having to
 *  guess search terms. The read tools remain for anything not included here
 *  (e.g. CVs, or docs trimmed by the per-scope caps). */
function contextBlock(c: AssembledContext): string {
  const sections: [string, string][] = [
    ["Workspace knowledge base", c.workspaceKb],
    ["Client knowledge base", c.clientKb],
    ["Client files", c.clientFiles],
    ["Project files", c.projectFiles],
  ].filter(([, v]) => v && v.trim()) as [string, string][];
  if (sections.length === 0) return "";
  const body = sections.map(([t, v]) => `## ${t}\n${v}`).join("\n\n");
  return (
    "# Project context\nThe following documents from this project and its " +
    "knowledge base are already available — use them directly; only call the " +
    "search/read tools for anything not present here.\n\n" +
    body
  );
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

/** The recruiter's own details from Settings > Personal, folded into every
 *  agent run as HIGHER-priority context than the knowledge base — so an agent
 *  uses the recruiter's real name, company, and signature, and these win over
 *  any conflicting KB info. */
function personalBlock(p: UserPreferences | null): string {
  if (!p) return "";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  const lines: string[] = [];
  if (name) lines.push(`- Recruiter's name: ${name}`);
  if (p.company_name) lines.push(`- Recruiter's company name: ${p.company_name}`);
  if (p.company_website)
    lines.push(`- Recruiter's company website: ${p.company_website}`);
  const sig = p.email_signature?.trim();
  if (lines.length === 0 && !sig) return "";
  let out =
    "# Recruiter & sender details\n" +
    "These are the recruiter's own details from their Calyflow settings. They " +
    "take precedence over anything in the knowledge base or project context " +
    "above — if a detail here conflicts with the KB, use THIS one.\n";
  if (lines.length > 0) out += `\n${lines.join("\n")}\n`;
  if (sig)
    out +=
      "\n## Email signature\n" +
      "Use this verbatim when signing off emails; do not alter or reformat it.\n" +
      sig +
      "\n";
  return out.trim();
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
  const allowed: string[] = baseAllowed.filter(
    (t) => !t.startsWith(CONNECTOR_REQUIREMENT_PREFIX),
  );
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
    const prefix = providerToolPrefix(provider);
    allowed.push(...ALL_TOOL_NAMES.filter((t) => t.startsWith(prefix)));
    chosenSources.push({ label, provider, prefix });
  }

  // Resolve a valid token for each connector the agent uses, up front
  // (refreshing if needed). A configured-but-broken connection fails the run
  // early with a clear reconnect message; a not-yet-connected one stays null so
  // its tools report "not connected" rather than failing the whole run.
  const tokenFor = async (
    prefix: string,
    provider: string,
  ): Promise<string | null> => {
    if (!allowed.some((t) => t.startsWith(prefix))) return null;
    const connection = await getConnection(session.workspaceId, provider);
    if (!connection) return null;
    return getValidAccessToken(connection);
  };
  let airtableToken: string | null = null;
  let apolloToken: string | null = null;
  let ashbyToken: string | null = null;
  let attioToken: string | null = null;
  let bamboohrToken: string | null = null;
  let breezyhrToken: string | null = null;
  let brightdataToken: string | null = null;
  let bullhornToken: string | null = null;
  let catsToken: string | null = null;
  let contactoutToken: string | null = null;
  let coresignalToken: string | null = null;
  let crelateToken: string | null = null;
  let fathomToken: string | null = null;
  let firefliesToken: string | null = null;
  let gmailToken: string | null = null;
  let gongToken: string | null = null;
  let googleSheetsToken: string | null = null;
  let greenhouseToken: string | null = null;
  let hubspotToken: string | null = null;
  let hunterToken: string | null = null;
  let instantlyToken: string | null = null;
  let jazzhrToken: string | null = null;
  let jobadderToken: string | null = null;
  let lemlistToken: string | null = null;
  let leverToken: string | null = null;
  let loxoToken: string | null = null;
  let lushaToken: string | null = null;
  let manatalToken: string | null = null;
  let microsoftExcelToken: string | null = null;
  let microsoftOutlookToken: string | null = null;
  let mondayToken: string | null = null;
  let notionToken: string | null = null;
  let peopledatalabsToken: string | null = null;
  let pinpointToken: string | null = null;
  let pipedriveToken: string | null = null;
  let recruiteeToken: string | null = null;
  let recruiterflowToken: string | null = null;
  let rocketreachToken: string | null = null;
  let signalhireToken: string | null = null;
  let smartleadToken: string | null = null;
  let smartrecruitersToken: string | null = null;
  let snovToken: string | null = null;
  let teamtailorToken: string | null = null;
  let tldvToken: string | null = null;
  let woodpeckerToken: string | null = null;
  let workableToken: string | null = null;
  let zohoCrmToken: string | null = null;
  let zohoRecruitToken: string | null = null;
  try {
    [
      airtableToken,
      apolloToken,
      ashbyToken,
      attioToken,
      bamboohrToken,
      breezyhrToken,
      brightdataToken,
      bullhornToken,
      catsToken,
      contactoutToken,
      coresignalToken,
      crelateToken,
      fathomToken,
      firefliesToken,
      gmailToken,
      gongToken,
      googleSheetsToken,
      greenhouseToken,
      hubspotToken,
      hunterToken,
      instantlyToken,
      jazzhrToken,
      jobadderToken,
      lemlistToken,
      leverToken,
      loxoToken,
      lushaToken,
      manatalToken,
      microsoftExcelToken,
      microsoftOutlookToken,
      mondayToken,
      notionToken,
      peopledatalabsToken,
      pinpointToken,
      pipedriveToken,
      recruiteeToken,
      recruiterflowToken,
      rocketreachToken,
      signalhireToken,
      smartleadToken,
      smartrecruitersToken,
      snovToken,
      teamtailorToken,
      tldvToken,
      woodpeckerToken,
      workableToken,
      zohoCrmToken,
      zohoRecruitToken,
    ] = await Promise.all([
      tokenFor("airtable_", "airtable"),
      tokenFor("apollo_", "apollo"),
      tokenFor("ashby_", "ashby"),
      tokenFor("attio_", "attio"),
      tokenFor("bamboohr_", "bamboohr"),
      tokenFor("breezyhr_", "breezyhr"),
      tokenFor("brightdata_", "brightdata"),
      tokenFor("bullhorn_", "bullhorn"),
      tokenFor("cats_", "cats"),
      tokenFor("contactout_", "contactout"),
      tokenFor("coresignal_", "coresignal"),
      tokenFor("crelate_", "crelate"),
      tokenFor("fathom_", "fathom"),
      tokenFor("fireflies_", "fireflies"),
      tokenFor("gmail_", "gmail"),
      tokenFor("gong_", "gong"),
      tokenFor("googlesheets_", "google-sheets"),
      tokenFor("greenhouse_", "greenhouse"),
      tokenFor("hubspot_", "hubspot"),
      tokenFor("hunter_", "hunter"),
      tokenFor("instantly_", "instantly"),
      tokenFor("jazzhr_", "jazzhr"),
      tokenFor("jobadder_", "jobadder"),
      tokenFor("lemlist_", "lemlist"),
      tokenFor("lever_", "lever"),
      tokenFor("loxo_", "loxo"),
      tokenFor("lusha_", "lusha"),
      tokenFor("manatal_", "manatal"),
      tokenFor("excel_", "microsoft-excel"),
      tokenFor("outlook_", "microsoft-outlook"),
      tokenFor("monday_", "monday"),
      tokenFor("notion_", "notion"),
      tokenFor("peopledatalabs_", "peopledatalabs"),
      tokenFor("pinpoint_", "pinpoint"),
      tokenFor("pipedrive_", "pipedrive"),
      tokenFor("recruitee_", "recruitee"),
      tokenFor("recruiterflow_", "recruiterflow"),
      tokenFor("rocketreach_", "rocketreach"),
      tokenFor("signalhire_", "signalhire"),
      tokenFor("smartlead_", "smartlead"),
      tokenFor("smartrecruiters_", "smartrecruiters"),
      tokenFor("snov_", "snov"),
      tokenFor("teamtailor_", "teamtailor"),
      tokenFor("tldv_", "tldv"),
      tokenFor("woodpecker_", "woodpecker"),
      tokenFor("workable_", "workable"),
      tokenFor("zohocrm_", "zoho-crm"),
      tokenFor("zohorecruit_", "zoho-recruit"),
    ]);
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
    airtableToken,
    apolloToken,
    ashbyToken,
    attioToken,
    bamboohrToken,
    breezyhrToken,
    brightdataToken,
    bullhornToken,
    catsToken,
    contactoutToken,
    coresignalToken,
    crelateToken,
    fathomToken,
    firefliesToken,
    gmailToken,
    gongToken,
    googleSheetsToken,
    greenhouseToken,
    hubspotToken,
    hunterToken,
    instantlyToken,
    jazzhrToken,
    jobadderToken,
    lemlistToken,
    leverToken,
    loxoToken,
    lushaToken,
    manatalToken,
    microsoftExcelToken,
    microsoftOutlookToken,
    mondayToken,
    notionToken,
    peopledatalabsToken,
    pinpointToken,
    pipedriveToken,
    recruiteeToken,
    recruiterflowToken,
    rocketreachToken,
    signalhireToken,
    smartleadToken,
    smartrecruitersToken,
    snovToken,
    teamtailorToken,
    tldvToken,
    woodpeckerToken,
    workableToken,
    zohoCrmToken,
    zohoRecruitToken,
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const steps: AgentRunStep[] = [];
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
          controller.enqueue(ndjson({ type: "text", value: text }));
          usage = { inputTokens: 500, outputTokens: 60, cachedInputTokens: 0 };
        } else {
          const lm = await getLanguageModel(
            primary.row.provider,
            primary.apiKey,
            model,
          );
          const tools = buildTools(ctx, allowed);
          let streamError: unknown = null;
          const result = streamText({
            model: lm,
            system: systemPrompt,
            prompt: userPrompt,
            tools,
            stopWhen: stepCountIs(agent.max_steps ?? 12),
            abortSignal: AbortSignal.timeout(540_000),
            onError: ({ error }) => {
              streamError = error;
            },
          });

          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
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
      const costUsd = await computeCostUsd(provider, model, usage).catch(
        () => null,
      );

      await db()
        .from("agent_runs")
        .update({
          status: succeeded ? "succeeded" : "failed",
          steps,
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

      if (!succeeded) {
        controller.enqueue(ndjson({ type: "error", message: failure }));
      }
      controller.enqueue(
        ndjson({ type: "done", runId, outputDocId, succeeded }),
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
