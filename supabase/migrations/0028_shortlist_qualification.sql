-- Shortlist + Qualification (Projects).
--
-- Shortlist runs a single private-harness "main Sourcing Agent" that sources
-- candidates against the active Sourcing Plan, scores each one (0-100) against
-- the active Qualification criteria, and stores them. Qualification is a
-- two-column page (markdown + agent chat) like the Sourcing Plan, whose agent
-- authors the criteria the Sourcing Agent scores against.

-- 1) Candidates store. A few standardized columns (name/email/linkedin/score/…)
--    + a flexible `raw` JSONB for the ad-hoc fields each data source returns
--    (queryable with Postgres JSON operators, no fixed schema). The untouched
--    source payload is also archived as a JSON file in the `documents` bucket
--    under {workspace}/project/{project}/candidates/{id}.json (storage_path).
create table if not exists candidates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references workspaces not null,
  project_id    uuid references projects not null,
  -- Which data source produced this row (coresignal | github | apollo | …).
  source        text,
  name          text,
  email         text,
  linkedin      text,
  -- 0-100 fit score the Sourcing Agent assigned against the qualification
  -- criteria; null until scored.
  score         int,
  -- Whether the candidate met the criteria bar (drives the "N qualified" goal).
  qualified     boolean not null default false,
  status        text not null default 'sourced', -- sourced | qualified | rejected
  -- Ad-hoc per-source fields (title, company, location, github_url, …).
  raw           jsonb not null default '{}'::jsonb,
  -- Bucket archive of the raw source payload (nullable; best-effort).
  storage_path  text,
  created_by    text,
  created_at    timestamptz default now()
);

-- Dedupe within a project by email / linkedin (case-insensitive). Partial so
-- many rows without an email/linkedin don't collide.
create unique index if not exists candidates_project_email_uniq
  on candidates (project_id, lower(email)) where email is not null;
create unique index if not exists candidates_project_linkedin_uniq
  on candidates (project_id, lower(linkedin)) where linkedin is not null;
-- Goal counter: count(*) where qualified.
create index if not exists candidates_project_qualified_idx
  on candidates (project_id, qualified);
-- Ad-hoc queries over the flexible fields.
create index if not exists candidates_raw_gin_idx on candidates using gin (raw);

alter table candidates enable row level security;

-- 2) Per-project sourcing targets the recruiter sets before running. Budget is
--    in USD — the same unit AI token costs are tracked in, so no conversion.
alter table projects
  add column if not exists sourcing_goal_qualified int,
  add column if not exists sourcing_budget_usd numeric(10,2);

-- 3) Shortlist run history. One row per Start/Continue click. Mirrors
--    sourcing_plan_runs (no workspace_agent_id — the Sourcing Agent is driven by
--    a private harness, not a stored agent) plus a couple of progress snapshots.
create table if not exists shortlist_runs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid references projects not null,
  status             text,        -- running | succeeded | failed
  steps              jsonb,       -- [{ type, tool, summary }] tool-call trace
  output_text        text,        -- the agent's closing summary
  error_message      text,
  provider           text,
  model              text,
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cost_usd           numeric(10,6),
  candidates_added   int,         -- saved this run
  qualified_after    int,         -- total qualified in the project after this run
  created_by         text,
  created_at         timestamptz default now()
);
create index if not exists shortlist_runs_project_idx
  on shortlist_runs (project_id, created_at);

alter table shortlist_runs enable row level security;

-- 4) Qualification generate/revise chat history. Exact mirror of
--    sourcing_plan_runs; turns of one chat share conversation_id.
create table if not exists qualification_runs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid references projects not null,
  conversation_id    uuid,
  status             text,        -- running | succeeded | failed
  task               text,        -- generate (null) or the revision instruction
  steps              jsonb,
  output_text        text,
  output_doc_id      uuid references documents,
  error_message      text,
  provider           text,
  model              text,
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cost_usd           numeric(10,6),
  created_by         text,
  created_at         timestamptz default now()
);
create index if not exists qualification_runs_project_idx
  on qualification_runs (project_id, conversation_id, created_at);

alter table qualification_runs enable row level security;
