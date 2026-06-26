-- Recruiter "Fit" feedback on shortlisted candidates. Distinct from the agent's
-- score/qualified/status: this is the human verdict (accept ✓ / reject ✗) with an
-- optional reason. It's fed back into future sourcing runs so the agent
-- calibrates — favouring profiles like the accepted ones and avoiding the
-- rejected patterns.
alter table candidates
  add column if not exists feedback text,          -- 'accepted' | 'rejected' | null
  add column if not exists feedback_reason text,   -- why not a fit (optional)
  add column if not exists feedback_at timestamptz,
  add column if not exists feedback_by text;

-- Quick lookup of the reviewed candidates when assembling the feedback block.
create index if not exists candidates_project_feedback_idx
  on candidates (project_id, feedback) where feedback is not null;
