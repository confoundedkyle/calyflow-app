// Central place for env-driven configuration (self-hosting readiness, SPEC §13).

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get appEncryptionKey() {
    return required("APP_ENCRYPTION_KEY");
  },

  /** Self-host mode: no Clerk orgs, every user lands in the single workspace. */
  get singleWorkspace() {
    return (
      process.env.SINGLE_WORKSPACE === "true" || !process.env.CLERK_SECRET_KEY
    );
  },
  get adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Optional shared passphrase gating single-workspace sign-in. When set,
   *  the sign-in form must submit a matching password before a session is
   *  issued — closes the "any email becomes admin" path for instances exposed
   *  to the internet. Leave unset for frictionless local dev. */
  get singleWorkspacePassword() {
    return process.env.SINGLE_WORKSPACE_PASSWORD ?? "";
  },
  get requireSingleWorkspacePassword() {
    return !!process.env.SINGLE_WORKSPACE_PASSWORD;
  },

  /** When false, the "Calyflow default" provider row is never created. */
  get platformProviderEnabled() {
    return (
      process.env.PLATFORM_PROVIDER_ENABLED !== "false" &&
      !!process.env.CALYFLOW_PLATFORM_API_KEY
    );
  },
  get platformApiKey() {
    return process.env.CALYFLOW_PLATFORM_API_KEY ?? "";
  },
  /** Underlying provider the platform key/model belong to (anthropic, openai,
   *  google, …). Must match the key in CALYFLOW_PLATFORM_API_KEY. */
  get platformProvider() {
    return process.env.CALYFLOW_PLATFORM_PROVIDER ?? "anthropic";
  },
  get platformModel() {
    return process.env.CALYFLOW_PLATFORM_MODEL ?? "claude-sonnet-4-6";
  },
  get oneTimePlatformCreditDefaultUsd() {
    return Number(process.env.ONE_TIME_PLATFORM_CREDIT_DEFAULT_USD ?? "11.00");
  },

  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },

  /** Firecrawl API key — powers the client "import from domain" researcher.
   *  Import is only offered when this is set. */
  get firecrawlApiKey() {
    return process.env.FIRECRAWL_API_KEY ?? "";
  },
  /** Hunter.io API key — optional contact enrichment for domain import. When
   *  unset the agent simply skips the contacts step. */
  get hunterApiKey() {
    return process.env.HUNTER_API_KEY ?? "";
  },

  /** Public base URL of this deployment, used to build OAuth redirect URIs
   *  (e.g. https://app.calyflow.com). No trailing slash. */
  get appBaseUrl() {
    return (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  },
  /** Airtable OAuth app credentials (the connector spike). */
  get airtableClientId() {
    return process.env.AIRTABLE_CLIENT_ID ?? "";
  },
  get airtableClientSecret() {
    return process.env.AIRTABLE_CLIENT_SECRET ?? "";
  },
  /** Bullhorn OAuth app credentials (issued by Bullhorn support / BH Connect).
   *  Auth and REST-login hosts default to the global swimlane routers; point
   *  them at a regional cluster (e.g. auth-emea.bullhornstaffing.com) if
   *  Bullhorn assigns one. */
  get bullhornClientId() {
    return process.env.BULLHORN_CLIENT_ID ?? "";
  },
  get bullhornClientSecret() {
    return process.env.BULLHORN_CLIENT_SECRET ?? "";
  },
  get bullhornAuthBase() {
    return (process.env.BULLHORN_AUTH_BASE ?? "https://auth.bullhornstaffing.com").replace(/\/$/, "");
  },
  get bullhornRestLoginBase() {
    return (process.env.BULLHORN_REST_LOGIN_BASE ?? "https://rest.bullhornstaffing.com").replace(/\/$/, "");
  },
  /** Vincere OAuth app credentials (Vincere App Store → API Authentication &
   *  Throttling). Vincere apps are usually public OAuth clients, so the secret
   *  is optional. The identity host is the OAuth + /oauth2/user service; the
   *  per-tenant API host is discovered from the id_token, not configured. Point
   *  the id base at https://id.vinceredev.com for the Vincere test environment. */
  get vincereClientId() {
    return process.env.VINCERE_CLIENT_ID ?? "";
  },
  get vincereClientSecret() {
    return process.env.VINCERE_CLIENT_SECRET ?? "";
  },
  get vincereIdBase() {
    return (process.env.VINCERE_ID_BASE ?? "https://id.vincere.io").replace(/\/$/, "");
  },
  /** Google OAuth app credentials (Cloud console; the Sheets connector).
   *  The OAuth client must be a Web application with the
   *  /api/connectors/google-sheets/callback redirect URI registered. */
  get googleClientId() {
    return process.env.GOOGLE_CLIENT_ID ?? "";
  },
  get googleClientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET ?? "";
  },
  /** JobAdder OAuth app credentials (developers.jobadder.com; the connector
   *  must request read + offline_access and register the
   *  /api/connectors/jobadder/callback redirect URI). */
  get jobadderClientId() {
    return process.env.JOBADDER_CLIENT_ID ?? "";
  },
  get jobadderClientSecret() {
    return process.env.JOBADDER_CLIENT_SECRET ?? "";
  },
  /** Microsoft OAuth app credentials (Entra app registration; the Excel
   *  connector). The app must be multi-tenant + personal accounts, with the
   *  /api/connectors/microsoft-excel/callback redirect URI registered as a
   *  Web platform URI. */
  get microsoftClientId() {
    return process.env.MICROSOFT_CLIENT_ID ?? "";
  },
  get microsoftClientSecret() {
    return process.env.MICROSOFT_CLIENT_SECRET ?? "";
  },
  /** Notion public OAuth integration credentials (notion.so/my-integrations;
   *  the integration must be public with the
   *  /api/connectors/notion/callback redirect URI registered). */
  get notionClientId() {
    return process.env.NOTION_CLIENT_ID ?? "";
  },
  get notionClientSecret() {
    return process.env.NOTION_CLIENT_SECRET ?? "";
  },
  /** Zoho OAuth app credentials (API console; one client serves CRM + Recruit).
   *  Zoho is region-sharded — a deployment targets ONE data center, set via the
   *  base URLs below (defaults are the US DC; use .eu/.in/... for others). */
  get zohoClientId() {
    return process.env.ZOHO_CLIENT_ID ?? "";
  },
  get zohoClientSecret() {
    return process.env.ZOHO_CLIENT_SECRET ?? "";
  },
  get zohoAccountsBase() {
    return (process.env.ZOHO_ACCOUNTS_BASE ?? "https://accounts.zoho.com").replace(/\/$/, "");
  },
  get zohoApiBase() {
    return (process.env.ZOHO_API_BASE ?? "https://www.zohoapis.com").replace(/\/$/, "");
  },
  get zohoRecruitApiBase() {
    return (process.env.ZOHO_RECRUIT_API_BASE ?? "https://recruit.zoho.com").replace(/\/$/, "");
  },
  /** Slack OAuth app credentials. Shared-app model by default: the hosted
   *  Calyflow Slack app (or a self-hoster's own app) lives in env, so workspaces
   *  connect in one click. The start/callback routes also honour a per-workspace
   *  oauth_client_id if one is ever stored (BYO fallback). The signing secret
   *  verifies inbound slash-command / event requests (PR2). */
  get slackClientId() {
    return process.env.SLACK_CLIENT_ID ?? "";
  },
  get slackClientSecret() {
    return process.env.SLACK_CLIENT_SECRET ?? "";
  },
  get slackSigningSecret() {
    return process.env.SLACK_SIGNING_SECRET ?? "";
  },

  /** Svix signing secret for the Clerk webhook endpoint. */
  get clerkWebhookSigningSecret() {
    return process.env.CLERK_WEBHOOK_SIGNING_SECRET ?? "";
  },
  /** Dev flag: stream a canned response instead of calling a provider. */
  get mockAi() {
    return process.env.MOCK_AI === "true";
  },

  /** Optional self-host fallback for the Sourcing Plan harness (the prompt/IP).
   *  Normally pulled from the private `system-config` Storage bucket; set this
   *  on instances that don't provision the bucket. See lib/sourcing-plan/harness.ts. */
  get sourcingPlanHarness() {
    return process.env.SOURCING_PLAN_HARNESS ?? "";
  },
  /** Optional self-host fallback for the Shortlist (main Sourcing Agent) harness.
   *  Normally pulled from the private `system-config` bucket. See
   *  lib/shortlist/harness.ts. */
  get shortlistHarness() {
    return process.env.SHORTLIST_HARNESS ?? "";
  },
  /** Optional self-host fallback for the Qualification criteria harness.
   *  See lib/qualification/harness.ts. */
  get qualificationHarness() {
    return process.env.QUALIFICATION_HARNESS ?? "";
  },
  /** Optional override for the Sourcing strategist harness (proposes the next
   *  wave). Unlike the others this one ships a generic committed fallback, so
   *  this env/bucket is only needed to swap in the proprietary version. See
   *  lib/sourcing/strategist.ts. */
  get strategistHarness() {
    return process.env.STRATEGIST_HARNESS ?? "";
  },
  /** Optional override for the SignalHire search-ladder spec. Ships a generic
   *  committed default (search is free — no credit-strategy IP), so this only
   *  swaps in a proprietary tier spec. See lib/sourcing/signalhire-ladder.ts. */
  get signalhireLadder() {
    return process.env.SIGNALHIRE_LADDER ?? "";
  },
  /** Optional override for the ContactOut search-ladder spec. Ships a basic
   *  committed default (search is free); swap in a tuned spec via bucket/env.
   *  See lib/sourcing/contactout-ladder.ts. */
  get contactoutLadder() {
    return process.env.CONTACTOUT_LADDER ?? "";
  },
  /** Optional self-host fallback for the Outreach (email drafting) harness.
   *  See lib/outreach/harness.ts. */
  get outreachHarness() {
    return process.env.OUTREACH_HARNESS ?? "";
  },
  /** Optional self-host fallback for the Coresignal search-ladder spec (the IP
   *  tier strategy, JSON). Normally pulled from the private `system-config`
   *  bucket. See lib/sourcing/coresignal-ladder.ts. */
  get coresignalLadder() {
    return process.env.CORESIGNAL_LADDER ?? "";
  },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
