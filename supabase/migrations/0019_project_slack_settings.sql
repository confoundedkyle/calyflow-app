-- Slack integration: per-project channel mapping + automated report cadence.
-- A project maps to one Slack channel; the daily/weekly reporter (a system
-- agent) posts its digest there on a schedule. RLS is already enabled in 0003
-- and app queries run service-role, so no new policies are needed.

alter table projects add column slack_channel_id    text;        -- e.g. C0123456789
alter table projects add column slack_channel_name  text;        -- e.g. proj-acme-devops (display only)
alter table projects add column report_frequency    text not null default 'off';  -- off | daily | weekly
alter table projects add column report_last_sent_at timestamptz; -- guards against double-sends within a window
