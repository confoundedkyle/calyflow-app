# Calyflow — Open-Source Recruiting OS

Calyflow lets recruiters run Claude-powered workflows without touching
prompts, skills, or code. The core loop:

> **Browse library → import workflow → attach docs → run → get output doc**

Workspaces hold **clients** (the companies you recruit for), clients hold
**projects** (one per role), and knowledge compounds at every level:
workspace KB ("how WE work"), client KB ("how THEY work"), project files
(JD, intake notes, CVs). Every run injects that context automatically and
streams the result back as a new project document.

**Launch workflows:** Intake-to-JD Builder · Sourcing Strategy Map · Outreach Writer ·
CV Screener · Candidate Submission Pack — a full search lifecycle.

## Stack

- **Next.js** (App Router, standalone output) on **GCP Cloud Run**
- **Supabase** — Postgres + Storage, service-role pattern (server-side only)
- **Clerk** — auth + Organizations (= workspaces), or `SINGLE_WORKSPACE`
  self-host mode with no Clerk dependency
- **Vercel AI SDK** — Anthropic / OpenAI / Google providers with
  priority-ordered fallback; usage + cost logged on every run

## Local development

You need **three things installed** first — everything else is automated:

- **Node 22+** (`nvm use` picks it up from `.nvmrc`)
- **Docker** — [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  or [Colima](https://github.com/abiosoft/colima) (`brew install colima`)
- **Supabase CLI** — `brew install supabase/tap/supabase` (or `npm i -g supabase`)

Then, from a fresh clone:

```bash
npm install
npm run setup     # boots local Supabase, writes .env.local, applies migrations, seeds
npm run dev       # open http://localhost:3000
```

`npm run setup` is idempotent — re-run it any time. It starts the local
Supabase stack (Docker), wires `.env.local` to it with the local keys
(no copy/paste), generates an `APP_ENCRYPTION_KEY`, and seeds the workflow
library. No cloud account or real API keys required to get a working app.

With no Clerk keys set, the app runs in **single-workspace mode**: sign in
with **any email** (owners come from `ADMIN_EMAILS`, default `you@example.com`),
no password. To run a workflow without an AI provider key, set `MOCK_AI=true`
in `.env.local` — it streams a canned response through the full run pipeline,
usage logging and all.

Common commands:

| Command | What it does |
|---|---|
| `npm run setup` | One-time (re-runnable) local bootstrap |
| `npm run dev` | Start the Next.js dev server |
| `npm run db:stop` | Stop the local Supabase stack (data persists) |
| `npm run db:reset` | Wipe + re-apply all migrations, then re-seed |
| `npm run seed` | Re-seed the workflow library + model catalog |

Local URLs: app `:3000` · Supabase Studio `:54323` · Mailpit (outgoing email) `:54324`.

### Database

Migrations live in `supabase/migrations/` (plain SQL). `npm run setup` (and
`supabase start`) apply them automatically; in production they're applied by
the deploy workflow. To reset a local DB to a clean schema, use
`npm run db:reset`. The schema is near-plain Postgres by design; see SPEC §13.

### Connecting to cloud Supabase instead

`npm run setup` targets a **local** Supabase stack — the recommended default.
To point at a hosted project instead, skip setup and fill in `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`APP_ENCRYPTION_KEY` in `.env.local` by hand (copy from `.env.example`).

### Workflows

The library's source of truth is `workflows/*.yaml`, seeded into
`library_workflows` by `scripts/seed.ts` (idempotent, upsert-by-slug).
Bump `version` in the YAML to publish an update — users see an opt-in
"v2 available" upgrade on their imported copies.

### Model catalog

`data/model-catalog-snapshot.json` seeds the model dropdowns; a daily job
(`POST /api/cron/sync-models`, bearer `CRON_SECRET`) refreshes the catalog
from [models.dev](https://models.dev). The UI only ever reads the DB.

## Configuration

Every platform-specific behavior is env-driven (see `.env.example`):

| Flag | Effect |
|---|---|
| `SINGLE_WORKSPACE` | Self-host mode: no Clerk orgs, every login lands in one workspace |
| `PLATFORM_PROVIDER_ENABLED` + `CALYFLOW_PLATFORM_API_KEY` | Enables the "Calyflow default" provider with one-time included credit (`ONE_TIME_PLATFORM_CREDIT_DEFAULT_USD`) |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for BYO API keys at rest — keep in Secret Manager |
| `MOCK_AI` | Dev: canned streaming response, full pipeline incl. usage logging |

Budgets: the platform credit gates only `provider='calyflow'` runs (staff-
adjustable only); the optional monthly spend limit (Settings → General)
gates **all** runs and resets each calendar month.

## Deploying

`.github/workflows/deploy.yml` builds the container, pushes to Artifact
Registry, applies Supabase migrations, and deploys to Cloud Run using
Workload Identity Federation. GCP project / region / WIF settings are repo
variables, so the same workflow deploys any GCP project — see the workflow
file header for the required variables and secrets.

## License

AGPL-3.0 for the platform (see `LICENSE`). Premium workflow bundles are
licensed separately.
