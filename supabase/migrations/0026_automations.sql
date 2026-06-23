-- Automation Hub. A library of autonomous automations (ATS/CRM enrichment,
-- daily reporting, client research) that an agency configures once — binding a
-- connector per required category (e.g. Vincere ATS + Apollo enrichment) — and
-- that run on a schedule. Mirrors the agent library/workspace split (seeded
-- from /automations/*.yaml, imported per workspace) and reuses agent_runs for
-- run history.

-- Global catalog (seeded from /automations/*.yaml)
create table library_automations (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique,
  name                text,
  description         text,
  summary             text,
  instructions        text,            -- system/goal prompt
  allowed_tools       jsonb,           -- string[]; includes connector:<category> placeholders
  model               text,            -- optional model override; null = workspace default
  max_steps           int default 12,  -- tool-loop step budget
  required_connectors jsonb default '[]'::jsonb,  -- [{category,label}] drives the binding UI + subtitle
  default_schedule    jsonb,           -- {kind:'daily'|'hourly'|'continuous', time?:'06:00'}
  task                text,            -- default objective passed to each run
  version             int default 1,
  featured            boolean default false,
  og_description      text,
  lead                text,
  long_description    text
);

-- Configured copies (snapshot at import + the workspace's binding/schedule)
create table workspace_automations (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid references workspaces not null,
  library_automation_id uuid references library_automations,  -- null if library row retired
  name                  text,
  instructions          text,
  allowed_tools         jsonb,
  model                 text,
  max_steps             int default 12,
  imported_version      int,
  connector_bindings    jsonb default '{}'::jsonb,  -- {ats:'vincere', tool:'apollo'}
  schedule              jsonb,                       -- {kind, time}
  enabled               boolean default false,
  status                text default 'healthy',      -- healthy | failed | running
  last_run_at           timestamptz,
  next_run_at           timestamptz,
  created_by            text,
  created_at            timestamptz default now(),
  archived_at           timestamptz
);
create index workspace_automations_workspace_idx on workspace_automations (workspace_id);

-- Reuse agent_runs for automation run history (no separate runs table). An
-- automation run has no project and no workspace_agent, so relax those NOT NULLs
-- and add the automation FK.
alter table agent_runs alter column project_id drop not null;
alter table agent_runs alter column workspace_agent_id drop not null;
alter table agent_runs add column workspace_automation_id uuid references workspace_automations;
create index agent_runs_automation_idx on agent_runs (workspace_automation_id);

alter table library_automations enable row level security;
alter table workspace_automations enable row level security;
