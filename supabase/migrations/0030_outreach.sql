-- Outreach (Projects subpage). Drafts personalized outreach emails to the
-- accepted shortlist candidates, the recruiter reviews/edits/approves each, and
-- the platform sends approved ones from the workspace's connected mailbox.

-- 1) One editable email draft per candidate. The drafting agent writes these
--    (status 'draft'); a human-triggered server action sends them (never the
--    agent — there's no LLM in the send path). Emails only ever go to the
--    candidate's stored email, never an invented address.
create table if not exists outreach_drafts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid references workspaces not null,
  project_id       uuid references projects not null,
  candidate_id     uuid references candidates not null,
  to_email         text,
  to_name          text,
  subject          text,
  body             text,
  status           text not null default 'draft', -- draft | sent | rejected | failed
  -- The recruiter edited the subject/body before sending.
  edited           boolean not null default false,
  -- Mailbox used to send (gmail | microsoft-outlook), set on send.
  provider         text,
  sent_message_id  text,
  error            text,
  sent_at          timestamptz,
  reviewed_by      text,
  created_by       text,
  created_at       timestamptz default now()
);

-- One active draft per candidate — re-drafting replaces the un-sent one.
create unique index if not exists outreach_drafts_project_candidate_uniq
  on outreach_drafts (project_id, candidate_id);
create index if not exists outreach_drafts_project_status_idx
  on outreach_drafts (project_id, status);

alter table outreach_drafts enable row level security;

-- 2) Drafting run history (one "Draft outreach" click). Mirrors shortlist_runs;
--    no workspace_agent_id (the agent is driven by the private outreach harness).
create table if not exists outreach_runs (
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
  drafts_created     int,
  created_by         text,
  created_at         timestamptz default now()
);
create index if not exists outreach_runs_project_idx
  on outreach_runs (project_id, created_at);

alter table outreach_runs enable row level security;
