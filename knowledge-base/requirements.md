# How Calyflow works (product model)

Calyflow is an open-source recruiting OS. Recruiters run AI **agents** against
their **projects** (a role being filled for a client). Next.js app + Supabase.

## Core entities (Supabase)
- `clients` → `projects` (a project belongs to a client; `is_demo` hides system ones).
- `library_agents` / `library_workflows` — the **curated catalog**, seeded from
  YAML (`agents/*.yaml`). Marketing + definition source of truth.
- `workspace_agents` / `workspace_workflows` — a workspace's **imported copies**
  (snapshot at import; `imported_version`, `archived_at`, `library_*_id` link).
- `documents` — scoped to `workspace` | `client` | `project`, typed by
  `doc_type` (`jd`, `intake_notes`, `scorecard`, `cv`, `other`, `output`,
  `sourcing_plan`, `qualification`). `output` = agent-created; `sourcing_plan` =
  the project's Plan-mode draft; `qualification` = the project's candidate-scoring
  criteria. `is_active` gates whether the AI sees a doc.
- `candidates` — per-project sourced candidates (standardized columns + a `raw`
  JSONB for ad-hoc per-source fields). Written by the Shortlist Sourcing Agent.
- `agent_runs` / `workflow_runs` / `shortlist_runs` / `qualification_runs` — run
  history (status, steps, tokens, cost, `output_doc_id`).

## Agents are the primary primitive
Workflows were folded into agents (the `workflows/` catalog is retired; the DB
tables stay for possible future complex multi-step workflows). An **agent** =
`instructions` (the prompt) + `allowed_tools` + `model` + `max_steps` + `context`.

- Run via `POST /api/agents/run` → NDJSON stream of `text` / `tool-call` /
  `tool-result` / `error` / `done` events (`done` carries `outputDocId`).
- Workflows (legacy) = single prompt → `POST /api/runs` (plain-text stream).

### Context is auto-injected at run time
Before an agent runs, the runtime prepends a **"# Project context"** block to the
system prompt: workspace KB + client KB + client files + project files (active,
**CVs excluded**) — `assembleContext` + `contextBlock` in `app/api/agents/run/route.ts`.
After project context, the runtime appends a **"# Recruiter & sender details"**
block from the running user's **Settings > Personal** prefs (`personalBlock` +
`getUserPreferences`), explicitly marked as **higher priority than the KB**
(overrides on conflict). Every agent gets it; the **Outreach Writer** uses it to
personalize and sign off (company name/website + verbatim signature).
So agent instructions should **use that provided context directly** and only call
the read tools for what's not in it (CVs, a specific/large doc).
`calyflow_search_documents` matches content **+ filename + doc_type**, returns
only **active** docs; `calyflow_read_document` fetches full text by id;
`calyflow_create_document` saves an `output` doc.

### Agent YAML config (`agents/<slug>.yaml`)
- `context`: `recruiting-project` (default) | `business-development`. Drives where
  it appears — recruiting-project agents show in a project's **Agents** tab; others
  are kept out (surfaced in their own context). Exposed in the public API + badges.
- `allowed_tools`: includes `connector:<category>` placeholders (ats/crm/data/email)
  → require a connected source; and `calyflow_*` KB tools.
- Per-agent **document needs** (required/optional) are curated in code:
  `AGENT_DOCUMENTS` / `agentDocSpec()` in `lib/workflow-graph.ts`. Required docs
  gate the run (Run disabled + upload prompt) and the sidebar readiness dot, and
  render the canvas "Documents" node.

## Import / snapshot / upgrade model
Importing copies library → workspace (a snapshot). Editing the copy never touches
the library. Versions don't auto-propagate: an **upgrade** action pulls the latest
library instructions into the copy. A library row retired from YAML orphans copies
(`library_*_id → null`) but keeps them working.

## Where things live in the UI
- **Project → Agents tab** (`/clients/[c]/projects/[p]/agents`): a sidebar lists the
  workspace's recruiting-project agents; pick one → run panel (`/agents/[itemId]`).
  Combined run history below.
- **Project → Documents tab**: "Your documents" (inputs via `ProjectFilesManager`)
  + "Agent-created documents" (`output` docs via `DocExplorer`).
- **Project → Sourcing Plan tab** (`/clients/[c]/projects/[p]/sourcing-plan`):
  "Plan mode" for the role. A streaming route (`/api/sourcing-plan/generate`,
  modelled on the agent run route) researches the landscape and drafts a plan,
  saved as the project's single active `doc_type='sourcing_plan'` document
  (`saveSourcingPlan` archives the prior one — JD-style one-active idiom). The
  driving prompt is **private IP**: it's pulled at runtime from the private
  `system-config` Storage bucket (`lib/sourcing-plan/harness.ts`, server-only;
  env fallback `SOURCING_PLAN_HARNESS`) and is **never committed** — provision it
  out-of-band with `scripts/upload-harness.mjs`. The system prompt = harness +
  active-connectors block + project/KB context + personal block. Generate/revise
  history lives in `sourcing_plan_runs` (no `workspace_agent_id`, unlike
  `agent_runs`). The panel (`SourcingPlanPanel`) edits the plan inline
  (`updateDocumentTextAction`) **and** via chat revision (threaded by
  `conversation_id`). **Progress loop:** execution sourcing agents
  (`github-sourcer`, the `sourcing-*` shortlisters) carry the
  `calyflow_log_sourcing_progress` tool — after they run they append an
  append-only line under a `## Progress log` section on the active plan doc
  (`lib/sourcing-plan/progress.ts`, `appendProgressEntry`). Since the plan is
  auto-injected into every run, the next agent sees what's already done. The log
  lives on the plan doc, so regenerating starts a fresh plan + log (old archived).
- **Project → Qualification tab** (`/clients/[c]/projects/[p]/qualification`):
  the same two-column doc+agent surface as the Sourcing Plan (they share
  `DocAgentPanel`; the page-specific wrappers `SourcingPlanPanel` /
  `QualificationPanel` just pass copy + endpoint). A private-harness agent
  (`lib/qualification/harness.ts`, key `qualification/harness.md`, env fallback
  `QUALIFICATION_HARNESS`) writes **qualification criteria** — testable "test
  cases" + a 0–100 scoring rubric built from the JD/intake — saved as the
  project's single active `doc_type='qualification'` doc (`saveQualification`,
  one-active idiom). Streaming route `/api/qualification/generate`; history in
  `qualification_runs`. Editable inline or via chat, exactly like the plan.
- **Project → Shortlist tab** (`/clients/[c]/projects/[p]/shortlist`): the
  recruiter sets a **goal** (number of qualified candidates) and a **budget in
  USD** (`projects.sourcing_goal_qualified` / `sourcing_budget_usd`, via
  `setSourcingTargetsAction`) and pushes **Start/Continue sourcing**. That runs
  the **main Sourcing Agent** — a private-harness agent (`lib/shortlist/harness.ts`,
  key `shortlist/harness.md`, env `SHORTLIST_HARNESS`) with access to the FULL
  enrichment/sourcing toolset (`SOURCING_AGENT_TOOLS` in `lib/agents/tools.ts` =
  all data tools minus outreach/write). Unlike the GitHub/Coresignal sourcers it
  picks tools per role. It runs **headless in the background** (`POST
  /api/shortlist/run` inserts a `shortlist_runs` row then does the work in
  `after()`, so the tab can close); the UI polls `GET /api/shortlist/run`. It
  **scores each candidate 0–100 inline** against the active Qualification criteria
  (auto-injected as project context) and saves via the `calyflow_save_candidate`
  tool. **Candidates** live in the `candidates` table — standardized columns
  (name/email/linkedin/source/score/qualified/status) **plus a `raw` JSONB** for
  ad-hoc per-source fields (queryable; the TS stack's "pandas for JSON"), and the
  raw payload is archived as JSON in the `documents` bucket under
  `{ws}/project/{proj}/candidates/{id}.json` (`lib/candidates/save.ts`, dedupes by
  email/linkedin via partial unique indexes; `calyflow_list_candidates` lets the
  agent resume without duplicating). Stops at the goal (`countQualified ≥ goal`)
  or step cap; the USD budget (`lib/shortlist/budget.ts`, no conversion — same
  unit as run cost) gates between runs. The loop runs in phases — **FIND**
  (breadth) → **VERIFY** (depth, enrich + re-score top finds) → **DIAGNOSE**
  (tool-free escalation when short of goal) — each a multi-round continuation
  bounded by step/budget ceilings (`lib/shortlist/run.ts`, `runPhase`). The live
  step trace (polled by `ShortlistPanel`) reads **Thought → Action → Observation**:
  `reasoningSettings(provider, model)` (`lib/providers.ts`) flips the right
  per-provider reasoning knob (Anthropic extended thinking, Gemini 2.5
  `includeThoughts`, OpenAI `reasoningSummary`; no-op elsewhere) and each step's
  `reasoningText` is recorded as a `type:"reasoning"` `AgentRunStep`. With
  reasoning on, step 0's forced `toolChoice` is dropped (Anthropic rejects forced
  tool use while thinking). On finish it appends a `## Progress log` line
  to the Sourcing Plan, so re-running **continues where it left off**. The
  candidate table's **Fit** column is a human-in-the-loop feedback loop: the
  recruiter marks each candidate ✓ accepted / ✕ rejected (with an optional reason)
  via `setCandidateFeedbackAction` (`candidates.feedback`/`feedback_reason`,
  migration 0029). Future runs inject a `# Recruiter feedback` block
  (`lib/candidates/feedback.ts` + `listCandidateFeedback`) so the agent favours
  accepted profiles and avoids rejected patterns. The table's **Email** column
  fills in candidate emails via the recruiter's own enrichment connectors (BYO —
  Calyflow stores none). Two paths, in `components/shortlist-enrich-dialog.tsx`
  + `lib/actions/enrichment.ts`: (1) a per-row **Find email** button does a
  one-click LinkedIn→email lookup when a *live* enrichment connector is connected
  (`LIVE_EMAIL_ENRICHMENT_PROVIDERS` in `lib/connectors.ts` — ContactOut, Prospeo,
  Nymeria, SignalHire — dispatched in `lib/enrichment/find-email.ts`, which
  regex-extracts the email from the adapter's text; a provider qualifies as *live*
  only if its adapter resolves a LinkedIn URL synchronously — SignalHire does via
  `withoutWaterfall`); (2) a tool-agnostic **CSV round-trip** for
  non-tech recruiters — the "Find emails" dialog downloads the good-fit candidates
  that still need an email (name + LinkedIn URL + blank email column + a hidden
  `calyflow_id` for exact re-matching), the recruiter enriches it in ContactOut /
  Hunter / similar, then re-imports; `importEnrichedCsvAction` takes the raw CSV and
  maps its columns with an **AI agent** (`aiEnrichmentColumnMapping`, mirroring the
  talent-pool `aiMapColumnsAction`; heuristic fallback `heuristicEnrichmentMapping`
  when no AI provider is configured or the AI mapping finds no email column — both
  in `lib/enrichment/csv.ts`, pure + unit-tested). This copes with any tool's export
  (ContactOut's `Personal Email` / `Work Email` / `Work Email Status` …), prefers a
  **personal** address as the candidate's primary email, and keeps the rest of the
  data (all emails, phone, and unmapped columns) under `raw.enrichment` for later
  talent-pool use. Matched by id then normalized LinkedIn URL; never clobbers an
  existing email. "Good fit" = accepted (✓) or qualified, never rejected.
  When no enrichment tool is connected, the button/dialog explains the options.
  LinkedIn URLs are stored in LinkedIn's canonical, **slash-terminated** form
  (`canonicalLinkedinUrl` in `lib/enrichment/csv.ts`, applied on save in
  `saveCandidate`, at live lookup, and in the CSV export) — ContactOut/similar pair
  the slash-terminated URL but often miss it without the slash, and LinkedIn
  redirects to that form anyway.
- **Project → Outreach tab** (`/clients/[c]/projects/[p]/outreach`): drafts
  personalized outreach **emails** to the candidates accepted in the Shortlist
  (Fit ✓ with an email; falls back to qualified-with-email —
  `selectOutreachCandidates`), the recruiter **reviews/edits/approves or rejects
  each draft**, and approved ones **send from the workspace's connected mailbox**
  (Gmail/Outlook). A private-harness agent (`lib/outreach/harness.ts`, key
  `outreach/harness.md`, env `OUTREACH_HARNESS`) drafts **only** — it has no
  email-send tool; it writes one draft per candidate via the new
  `calyflow_save_outreach_draft` tool (recipient taken from the candidate's stored
  email, never invented). Background run (`POST /api/outreach/draft` → `after()`
  `runOutreachDrafting`; UI polls), drafts stored in `outreach_drafts` (one per
  candidate, status `draft|sent|rejected|failed`), run history in `outreach_runs`
  (migration 0030). **Sending is NOT an AI run** — `sendOutreachDraftAction` /
  `sendAllOutreachAction` (`lib/actions/outreach.ts`) call the Gmail/Outlook
  adapter directly with the human-approved text (`lib/outreach/send.ts`
  `resolveEmailProvider`). The panel (`components/outreach-panel.tsx`) shows the
  drafting trace, editable subject/body cards, per-draft Approve & send / Reject,
  and a bulk Send all.
- **Agents (top nav, `/workflows` route)**: workspace-level "My agents" manage list;
  each card → agent edit page (`/agents/[agentId]`: name + instructions, archive,
  upgrade, delete).
- **Knowledge base tab** (`/knowledge`): the workspace KB (auto-injected into every
  run). New workspaces start **empty** — no fill-in-the-blank starter templates
  (the old `data/default-knowledge-base` seeding was removed). Instead a guided
  **"Start creating"** assistant (`KbOnboardingPanel`) opens a chat that asks a few
  questions per area and writes the answers into KB documents via the
  `onboarding_save_kb_doc` tool. The areas to capture + conversational playbook
  are authored once in `lib/kb-onboarding/{areas,guidelines}.ts` (the assistant's
  system prompt). Streaming route `/api/knowledge/onboarding` (workspace-scoped,
  modelled on the qualification route); turns persist in `kb_onboarding_runs`
  (migration 0034) and reload by `conversation_id`, so onboarding is **resumable**
  across sessions and documents are **enriched** on return (upsert by filename).
  Created docs render below in the usual `DocExplorer`.
- **Settings > Personal** (`/settings/personal`): per-user prefs in
  `user_preferences` (keyed by workspace_id + user_id). First/last name **sync to
  Clerk** (source of truth; mirrored to the table for run-time reads). Email
  section — company name, company website (bare domain), plaintext signature —
  feeds the recruiter/sender context block above. Per-user, so no admin gate.
- **Project → Settings tab** (`/clients/[c]/projects/[p]/settings`): maps the
  project to a **Slack channel** and sets the **report cadence** (off/daily/weekly).
  Persists `slack_channel_id` / `slack_channel_name` / `report_frequency` on
  `projects` (`updateProjectSlackSettingsAction`; `createProjectChannelAction`
  spins up a dedicated channel). Turning reports on auto-imports the
  `slack-daily-report` agent into the workspace.
- **Library (`/library`)**: curated catalog to import from.
- **Demo (`/demo`)**: the real CV Screener agent, end-to-end.
- **Run detail**: `/runs/[id]` (workflow), `/agent-runs/[id]` (agent). Usage at
  `/settings/usage`. Dashboard (`/`) shows merged recent runs.
- **Canvas** ("How it works"): `WorkflowCanvas` from a graph built by
  `deriveAgentGraph` / `deriveWorkflowGraph` (`lib/workflow-graph.ts`, pure). Clicking
  a node opens a modal; the skill node shows the full instructions.

## Slack connector & reporting (a "comms" connector)
Slack is a workspace connector (`provider: "slack"`, category `comms`) — shared
OAuth app by default (`SLACK_CLIENT_ID/SECRET` in env, one-click Connect), with
per-workspace BYO as a fallback the start/callback routes already honour
(`oauth_client_id || env`). The stored credential is a non-expiring **bot token**
(no refresh). Adapter: `lib/integrations/slack.ts` (`postMessage`, `listChannels`,
`createChannel`, `joinChannel`); agent tools `slack_post_message` /
`slack_list_channels`. `lib/slack.ts` posts directly (non-LLM path) and converts
Markdown→Slack mrkdwn; `slackDeliveryBlock()` holds the "how to talk to hiring
managers in Slack" guidance.

**Headless runs.** `runAgentHeadless()` (`lib/agents/run.ts`) runs an agent to
completion without a session or stream — the shared core for automated triggers.
The interactive route (`/api/agents/run`) and it both use
`resolveConnectorTokens()` (`lib/agents/connector-tokens.ts`) and the prompt
blocks in `lib/agents/prompt.ts`.

**Daily/weekly reports.** The `slack-daily-report` agent ("Reporting on Slack")
posts a short, hiring-manager-friendly project digest. `/api/cron/slack-reports`
(bearer `CRON_SECRET`, like `sync-models`) is pinged hourly by Cloud Scheduler;
it runs the report agent (as a workspace service user) for each active project
whose `report_frequency` is due (default send hour 08:00 UTC; `?force=1` bypasses
the schedule gate for testing) and posts the output to its channel.

**Inbound bot (run agents from Slack).** `/calyflow <agent> <task>`
(`app/api/slack/commands`) and `@Calyflow <agent> <task>` mentions
(`app/api/slack/events`) run a recruiting agent and post the result back.
Requests are authenticated by Slack signature (`verifySlackRequest`,
`SLACK_SIGNING_SECRET`) — inbound assumes ONE Slack app, not per-workspace. The
channel resolves the workspace via `getProjectBySlackChannel` (channel → project →
workspace); shared logic lives in `lib/agents/slack-bot.ts`
(`resolveAgentForToken` by library slug then name, `agentMenuText` skill menu,
`runAndPost`). Both routes **ack within 3 s** and do the run in Next.js `after()`
(`maxDuration` 600). `/calyflow` alone (or `help`) lists the workspace's runnable
agents. Needs the `commands` + `app_mentions:read` scopes, so workspaces connected
before Stage 2 must reconnect. Slack-app config (slash command + Event
Subscriptions request URLs, scopes) is set on the Slack app, not in code.

## Public API (`/api/v1`, unauthenticated, marketing site)
- `GET /library` — catalog (agents + workflows). Marketing metadata + `context` +
  `documents` + `connectors`. **Never** leaks `prompt_template` / `instructions`.
- `GET /library/[type]/[slug]/cover` — 16:9 SVG of the canvas.
- `GET /connectors` — connector catalog.

## Naming convention
Document surfaces are all called **"Documents"** (project, client, workspace tabs).
