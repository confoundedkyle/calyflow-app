import {
  CONNECTORS,
  CONNECTOR_CATEGORY_LABELS,
  CONNECTOR_DOMAINS,
  connectorFaviconUrl,
  type Connector,
  type ConnectorCategory,
} from "../connectors";
import { getSelfHostSetup, type SelfHostSetup } from "./self-hosting";

// Authored, non-technical docs content per connector. The catalog
// (lib/connectors.ts) is the source of truth for name/category/auth/blurb/hints;
// here we add the human prose: what agents can do with it, concrete use cases,
// how to connect, connection options, and what to know about configuration &
// data handling. Un-authored connectors still render a deep page — capabilities
// fall back to the blurb, and use cases / configuration fall back to sensible
// per-category defaults — so adding a connector never leaves a thin page.

export interface ConnectorDocContent {
  /** Plain-language "what agents can do with it". */
  capabilities?: string[];
  /** Concrete recruiting scenarios this connector unlocks. */
  useCases?: string[];
  /** What the user needs before connecting (account, admin rights, plan). */
  whatYouNeed?: string[];
  /** Numbered, non-technical "where to get your key / how to connect" steps. */
  steps?: string[];
  /** Alternative ways to connect, regional/cluster choices, or key formats. */
  connectionOptions?: string[];
  /** What to know about configuration & data handling once connected. */
  configuration?: string[];
  /** Helpful links (provider docs / settings pages). */
  links?: { label: string; url: string }[];
}

// Per-category fallbacks so every connector page has real depth even before it's
// individually authored. `{name}` is replaced with the connector's name.
const CATEGORY_USE_CASES: Record<ConnectorCategory, string[]> = {
  ats: [
    "Pull a specific role's candidates into a ranked shortlist",
    "Screen synced candidates against the job description and scorecard",
    "Resurface strong past applicants worth re-approaching for a new opening",
  ],
  crm: [
    "Brief yourself on a client account before a business-development call",
    "Find the right decision-maker at a target company for outreach",
    "Prioritise which roles to work first based on open deals and contacts",
  ],
  data: [
    "Turn a spreadsheet of candidates into a personalised outreach run",
    "Read a shared client or candidate tracker without copy-pasting it in",
    "Feed a list of leads into a sourcing or enrichment agent",
  ],
  email: [
    "Send personalised first-touch outreach from your own address",
    "Follow up with a whole shortlist at scale, each message signed off as you",
  ],
  comms: [
    "Run a sourcing or screening agent from your team's Slack channel",
    "Get an automatic daily or weekly project status posted to the channel",
  ],
  tool: [
    "Find verified emails and phone numbers for a shortlist",
    "Enrich sourced candidates with their current role and company",
    "Build a contactable list from a targeted search",
  ],
};

const CATEGORY_CONFIG: Record<ConnectorCategory, string[]> = {
  ats: [
    "Read-only: Calyflow queries your {name} on demand and never writes back to it — agents only pull the records a task needs, scoped to your workspace.",
  ],
  crm: [
    "Read-only: agents query your {name} for the accounts and contacts a task needs; Calyflow doesn't change your CRM data.",
  ],
  data: [
    "Read-only access to the spreadsheets and files you share — Calyflow reads them for a run and never edits your originals.",
  ],
  email: [
    "Sends from the connected mailbox. You choose which mailbox to use on each outreach run, and only the messages an agent drafts for that run are sent.",
  ],
  comms: [
    "Posts to the channel you link to a project (in the project's Settings → Slack). Each project can use its own channel.",
  ],
  tool: [
    "Agents call {name} only when a task needs it. Lookups draw on your account's credits/quota with {name}, so usage counts against your plan there.",
  ],
};

export const DOC_CONNECTORS: Record<string, ConnectorDocContent> = {
  // ── ATS ──────────────────────────────────────────────────────────────────
  ashby: {
    capabilities: [
      "List your open jobs and their pipelines",
      "List and search candidates to build shortlists",
    ],
    useCases: [
      "Shortlist the strongest candidates already in a role's Ashby pipeline",
      "Screen a job's applicants against its scorecard in one run",
      "Surface earlier applicants who fit a newly opened role",
    ],
    whatYouNeed: ["An Ashby account with admin access (to create an API key)"],
    steps: [
      "In Ashby, open Admin → Integrations → API.",
      "Create a new API key and copy it.",
      "In Calyflow, go to Settings → Connectors → Ashby and paste the key.",
    ],
    configuration: [
      "Read-only: Calyflow queries Ashby on demand and never writes back to it.",
    ],
  },
  greenhouse: {
    capabilities: [
      "List jobs and the candidates attached to them",
      "Search candidates to assemble a shortlist for a role",
    ],
    useCases: [
      "Build a ranked shortlist for a Greenhouse job in seconds",
      "Screen a job's applicants against the JD and your scorecard",
      "Re-engage strong past applicants for a similar new role",
    ],
    whatYouNeed: ["A Greenhouse account with permission to create a Harvest API key"],
    steps: [
      "In Greenhouse, go to Configure (gear) → Dev Center → API Credential Management.",
      "Create a Harvest API key with read access to jobs and candidates, and copy it.",
      "In Calyflow, open Settings → Connectors → Greenhouse and paste the key.",
    ],
    connectionOptions: [
      "Calyflow uses Greenhouse's Harvest API (read). Give the key only the job and candidate read permissions it needs.",
    ],
  },
  bullhorn: {
    capabilities: [
      "Sync jobs, candidates, and submissions from your Bullhorn",
      "Search candidates to shortlist for an open role",
    ],
    useCases: [
      "Mine your existing Bullhorn database for a live role instead of sourcing cold",
      "Pull a job's submissions into a screening run",
      "Find past placements and silver-medalists to re-approach",
    ],
    whatYouNeed: [
      "A Bullhorn account",
      "OAuth credentials issued by Bullhorn (your account manager / support enables API access)",
    ],
    steps: [
      "On the hosted version, open Settings → Connectors → Bullhorn and click Connect, then sign in to Bullhorn and approve access.",
      "If your account is on a regional cluster, Bullhorn support will tell you — self-hosters set the matching base URLs (see Self-hosting below).",
    ],
    connectionOptions: [
      "Bullhorn runs several regional data centres (\"swimlanes\"). Hosted users are routed automatically; self-hosters point BULLHORN_AUTH_BASE / BULLHORN_REST_LOGIN_BASE at their cluster.",
    ],
  },
  bamboohr: {
    useCases: [
      "Pull applicants from a BambooHR job into a shortlist",
      "Screen a role's applicants against its requirements",
    ],
    connectionOptions: [
      "The key field is `company-domain:api-key` — the company domain is the part before .bamboohr.com.",
    ],
  },
  loxo: {
    useCases: [
      "Search your Loxo people database for a live role",
      "Pull a job's candidates into a screening or shortlist run",
    ],
    whatYouNeed: [
      "A Loxo account",
      "Open API access — a paid Loxo feature — to create an API key",
    ],
    connectionOptions: [
      "The key field is `agency-slug:api-key` — the slug is the subdomain in your Loxo URL ({slug}.app.loxo.co).",
    ],
  },
  vincere: {
    capabilities: [
      "Search candidates, contacts, and companies in your Vincere",
      "Search applications and list talent pools to source from",
    ],
    useCases: [
      "Run a structured sourcing sequence across your Vincere database for a role",
      "Pull a talent pool into a shortlist or outreach run",
      "Find contacts and companies for business-development research",
    ],
    whatYouNeed: [
      "A Vincere account with access to API settings",
      "An OAuth app registered in your own Vincere instance (Vincere issues a Client ID per customer)",
    ],
    steps: [
      "In Vincere, go to Settings → API → API Authentication & Throttling.",
      "Register an app using the redirect URL Calyflow shows on the Connect screen.",
      "Copy the app's Client ID, paste it in Calyflow, then click Connect and approve. (Add a Client Secret only if Vincere issued your app a confidential one.)",
    ],
    connectionOptions: [
      "Vincere is bring-your-own-OAuth even on the hosted version, because it issues a Client ID per customer instance.",
      "Self-hosters/testers can point VINCERE_ID_BASE at the Vincere test environment (id.vinceredev.com).",
    ],
  },
  recruitis: {
    capabilities: [
      "List your jobs and their candidate pipelines",
      "Pull the applicants on a role, with each candidate's current pipeline stage",
    ],
    useCases: [
      "Build a ranked shortlist from a Recruitis job's applicants",
      "Screen a role's candidates against its job description and scorecard",
      "Resurface strong past applicants worth re-approaching for a new opening",
    ],
    whatYouNeed: [
      "A Recruitis account that can generate an API token (Settings → API)",
    ],
    steps: [
      "In Recruitis, open Settings → API and generate a token.",
      "Give it the read scopes (e.g. api.position.read and api.candidates.read) and copy it.",
      "In Calyflow, go to Settings → Connectors → Recruitis and paste the token.",
    ],
    configuration: [
      "Read-only: Calyflow queries Recruitis on demand and never writes back to it.",
    ],
    links: [{ label: "Recruitis API docs", url: "https://docs.recruitis.io/api/" }],
  },

  // ── CRM ──────────────────────────────────────────────────────────────────
  close: {
    capabilities: [
      "Search leads (client companies / accounts) and their primary contacts",
      "List BD opportunities (deals) for the pipeline or a single account",
    ],
    useCases: [
      "Brief yourself on a client account before a business-development call",
      "Find the right contact at a target company for outreach",
      "Prioritise which roles to work first based on open opportunities and their value",
    ],
    whatYouNeed: ["A Close account with permission to create an API key"],
    steps: [
      "In Close, go to Settings → Developer → API Keys.",
      "Create a new API key and copy it.",
      "In Calyflow, go to Settings → Connectors → Close and paste the key.",
    ],
    configuration: [
      "Read-only: Calyflow queries Close for the leads and opportunities a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Close API docs", url: "https://developer.close.com/" },
    ],
  },
  folk: {
    capabilities: [
      "List people (contacts) with their email, phone, title, and company",
      "List client companies in your folk workspace",
    ],
    useCases: [
      "Brief yourself on a client contact before a call using their folk record",
      "Pull your network of people and companies into research and outreach",
      "Find the right contact at a target account for business development",
    ],
    whatYouNeed: ["A folk account with permission to create an API key"],
    steps: [
      "In folk, go to Settings → Workspace → API.",
      "Create an API key and copy it.",
      "In Calyflow, go to Settings → Connectors → folk and paste the key.",
    ],
    configuration: [
      "Read-only: Calyflow reads the people and companies a task needs and never changes your folk data.",
    ],
    links: [
      { label: "folk API docs", url: "https://developer.folk.app/" },
    ],
  },
  hubspot: {
    capabilities: [
      "Search client companies, contacts, and deals",
      "Pull BD pipeline context into research and outreach",
    ],
    useCases: [
      "Brief yourself on a client company before a call using its HubSpot record",
      "Find the right contact at a target account for outreach",
      "Prioritise roles to work based on open deals",
    ],
    whatYouNeed: ["A HubSpot account with permission to create a private app token"],
    steps: [
      "In HubSpot, go to Settings → Integrations → Private Apps.",
      "Create a private app with read scopes for contacts, companies, and deals, then copy its access token.",
      "Paste the token in Calyflow under Settings → Connectors → HubSpot.",
    ],
    connectionOptions: [
      "Give the private app only read scopes for contacts, companies, and deals.",
    ],
  },
  notion: {
    capabilities: [
      "Read the databases and pages your team runs recruiting on",
      "Pull candidate or client records into agent context",
    ],
    useCases: [
      "Use a Notion candidate or client database as a source for agents",
      "Pull a role brief or client notes kept in Notion into a run",
    ],
    whatYouNeed: ["A Notion account and the ability to share pages with an integration"],
    steps: [
      "On the hosted version, open Settings → Connectors → Notion, click Connect, and choose which pages to share.",
    ],
    configuration: [
      "Agents can only read the specific pages and databases you share with the integration — share exactly what you want them to see.",
    ],
  },

  // ── Data & spreadsheets ───────────────────────────────────────────────────
  "google-sheets": {
    capabilities: [
      "Read candidate and client trackers straight from your Sheets",
      "Feed a spreadsheet of candidates into outreach and sourcing agents",
    ],
    useCases: [
      "Run personalised outreach to everyone in a candidate sheet",
      "Enrich a list of leads kept in a spreadsheet with verified contacts",
      "Use a shared client tracker as live context for an agent",
    ],
    whatYouNeed: ["A Google account with access to the spreadsheets you want to use"],
    steps: [
      "Open Settings → Connectors → Google Sheets and click Connect.",
      "Sign in with Google and allow read access to your spreadsheets.",
    ],
  },
  gmail: {
    capabilities: ["Send candidate outreach from your own Gmail address"],
    useCases: [
      "Send a personalised first-touch email to each candidate on a shortlist",
      "Follow up with a list of candidates at scale, signed off as you",
    ],
    whatYouNeed: ["A Gmail or Google Workspace account"],
    steps: [
      "Open Settings → Connectors → Gmail and click Connect.",
      "Sign in with Google and allow Calyflow to send mail on your behalf.",
    ],
    configuration: [
      "Mail is sent from the connected address. Set your name, company, and signature in Settings → Personal so outreach is signed off correctly.",
    ],
  },
  "microsoft-outlook": {
    capabilities: ["Send candidate outreach from your Outlook / Microsoft 365 mailbox"],
    useCases: [
      "Send personalised outreach from your Microsoft 365 mailbox",
      "Run follow-ups to a shortlist from Outlook at scale",
    ],
    whatYouNeed: ["A Microsoft 365 / Outlook account"],
    steps: [
      "Open Settings → Connectors → Microsoft Outlook and click Connect.",
      "Sign in with Microsoft and approve sending mail on your behalf.",
    ],
  },

  // ── Comms ────────────────────────────────────────────────────────────────
  slack: {
    capabilities: [
      "Run any recruiting agent from a Slack channel with /calyflow or @Calyflow",
      "Receive automated daily or weekly project reports in the channel",
    ],
    useCases: [
      "Let the whole pod trigger sourcing or screening from a project channel",
      "Post an automatic morning status update to the hiring manager's channel",
      "Kick off a quick run from your phone without opening the app",
    ],
    whatYouNeed: ["A Slack workspace where you can install apps"],
    steps: [
      "Open Settings → Connectors → Slack and click Connect, then approve the Calyflow app in Slack.",
      "In a project's Settings → Slack, pick (or create) a channel for that project.",
      "In the channel, type /calyflow to see the available agents.",
    ],
    connectionOptions: [
      "Hosted: one-click with the Calyflow Slack app. Self-hosting: create your own Slack app and set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET (see Self-hosting).",
    ],
    configuration: [
      "Link a channel per project in the project's Settings → Slack, and choose the automated-report cadence (off / daily / weekly) there.",
    ],
    links: [
      { label: "Running agents from Slack — full guide", url: "/docs/automation/slack" },
    ],
  },

  // ── Sourcing & enrichment tools ───────────────────────────────────────────
  github: {
    capabilities: [
      "Search open-source repositories by topic and language",
      "Find a repo's contributors and the people who forked it",
      "Pull public commit-email contacts for outreach",
    ],
    useCases: [
      "Find maintainers and contributors of a library your client's stack uses",
      "Build a shortlist of engineers active in a specific language or domain",
      "Get public commit emails so you can reach engineers directly",
    ],
    whatYouNeed: ["A GitHub account (free is fine)"],
    steps: [
      "Go to github.com → Settings → Developer settings → Personal access tokens.",
      "Create a token: a classic token with the public_repo scope, OR a fine-grained read-only token, is enough.",
      "Copy the token and paste it in Calyflow under Settings → Connectors → GitHub.",
    ],
    connectionOptions: [
      "Either token type works: a classic token with the `public_repo` scope, or a fine-grained read-only token.",
    ],
    configuration: [
      "Only public data is used. A token mainly raises GitHub's rate limits so larger searches don't stall.",
    ],
    links: [
      { label: "GitHub: create a personal access token", url: "https://github.com/settings/tokens" },
    ],
  },
  apollo: {
    capabilities: [
      "Search the 270M-profile B2B database for people and companies",
      "Enrich a person with verified contact details",
    ],
    useCases: [
      "Build a list of people matching a title, industry, and location",
      "Enrich a shortlist with verified work emails before outreach",
      "Find decision-makers at a client's target companies",
    ],
    whatYouNeed: ["An Apollo account with API access"],
    steps: [
      "In Apollo, go to Settings → Integrations → API and create an API key.",
      "Paste it in Calyflow under Settings → Connectors → Apollo.",
    ],
    configuration: [
      "Searches and enrichment draw on your Apollo credits, so usage counts against your Apollo plan.",
    ],
  },
  hunter: {
    capabilities: [
      "Find work email addresses for a company domain",
      "Verify whether an email address is deliverable",
    ],
    useCases: [
      "Find the likely work email for a sourced candidate",
      "Verify a list of emails before a campaign to protect deliverability",
    ],
    whatYouNeed: ["A Hunter.io account"],
    steps: [
      "In Hunter, open your account → API and copy your API key.",
      "Paste it in Calyflow under Settings → Connectors → Hunter.io.",
    ],
  },
  coresignal: {
    capabilities: [
      "Search employees by role, company, and location",
      "Enrich candidates with fresh public employment data",
    ],
    useCases: [
      "Source candidates by current title, company, and location",
      "Enrich a shortlist with up-to-date role and tenure data",
      "Find people who recently left a target company",
    ],
    whatYouNeed: ["A Coresignal account with API access"],
    steps: [
      "In Coresignal, copy your API key from the dashboard.",
      "Paste it in Calyflow under Settings → Connectors → Coresignal.",
    ],
  },
  dropcontact: {
    capabilities: [
      "Find and verify a professional email for a contact",
      "Add phone, job title, company, and LinkedIn from partial details",
    ],
    useCases: [
      "Find a GDPR-compliant work email for a sourced European candidate",
      "Enrich a thin candidate record (just a name + company) into a contactable one",
      "Verify and complete client-contact details before a BD outreach run",
    ],
    whatYouNeed: [
      "A Dropcontact account on a paid plan (API access requires a subscription)",
    ],
    steps: [
      "In Dropcontact, open Settings → Your API key and copy the key.",
      "In Calyflow, go to Settings → Connectors → Dropcontact and paste it.",
    ],
    configuration: [
      "Enrichment is asynchronous: a request is submitted, then the result is fetched a few seconds later — agents handle this automatically.",
      "Dropcontact is GDPR-native and EU-focused, processing data in Europe; lookups draw on your Dropcontact credit balance.",
    ],
    links: [
      { label: "Dropcontact API docs", url: "https://developer.dropcontact.com/" },
    ],
  },
  fullenrich: {
    capabilities: [
      "Find a verified work email and mobile number for a contact",
      "Run a 15+ vendor waterfall from a name + company or a LinkedIn URL",
    ],
    useCases: [
      "Get a contactable email and phone for a sourced candidate",
      "Enrich a thin lead (name + company) into a reachable contact for BD outreach",
      "Fill in missing mobile numbers before a calling campaign",
    ],
    whatYouNeed: ["A FullEnrich account with API access"],
    steps: [
      "In FullEnrich, open app.fullenrich.com → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → FullEnrich and paste it.",
    ],
    configuration: [
      "Enrichment is asynchronous: a request is submitted, then the result is fetched a few seconds later — agents handle this automatically.",
      "FullEnrich waterfalls across many data vendors and charges credits only for found results; lookups draw on your FullEnrich balance.",
    ],
    links: [
      { label: "FullEnrich API docs", url: "https://docs.fullenrich.com/" },
    ],
  },
  findymail: {
    capabilities: [
      "Find a verified work email from a name and company domain",
      "Find a direct mobile from a LinkedIn URL, and verify deliverability",
    ],
    useCases: [
      "Find the likely work email for a sourced candidate, already verified",
      "Get a direct mobile number for a candidate from their LinkedIn profile",
      "Verify a list of emails before a campaign to protect deliverability",
    ],
    whatYouNeed: ["A Findymail account with API access"],
    steps: [
      "In Findymail, open app.findymail.com → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Findymail and paste it.",
    ],
    configuration: [
      "Lookups are synchronous and draw on your Findymail finder and verifier credits; phone search excludes EU numbers for GDPR.",
    ],
    links: [
      { label: "Findymail API docs", url: "https://www.findymail.com/api/" },
    ],
  },
  avoma: {
    capabilities: [
      "List recorded calls in a date window with attendees and links",
      "Read the speaker-attributed transcript of a meeting",
    ],
    useCases: [
      "Pull the transcript of a client intake call to capture exactly what was asked for",
      "Review a candidate screening call without re-listening to the recording",
      "Brief an agent on a role using the notes from the kickoff call",
    ],
    whatYouNeed: ["An Avoma account with a scoped API key"],
    steps: [
      "In Avoma, go to Settings → API and create a scoped API key.",
      "In Calyflow, go to Settings → Connectors → Avoma and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your meetings and transcripts and never changes anything in Avoma. The key returns the meetings of the user it belongs to.",
    ],
    links: [
      { label: "Avoma API docs", url: "https://dev.avoma.com/" },
    ],
  },
  wiza: {
    capabilities: [
      "Reveal a verified work email and mobile number from a LinkedIn profile",
      "Enrich a contact from an email or a name + company",
    ],
    useCases: [
      "Turn a sourced LinkedIn profile into a contactable email and phone",
      "Get a direct mobile for a candidate before a calling campaign",
      "Enrich a thin lead (name + company) into a reachable contact for BD",
    ],
    whatYouNeed: ["A Wiza account with API access"],
    steps: [
      "In Wiza, open Settings → API and create an API key.",
      "In Calyflow, go to Settings → Connectors → Wiza and paste it.",
    ],
    configuration: [
      "Reveals are asynchronous: a request is submitted, then the result is fetched a few seconds later — agents handle this automatically.",
      "Lookups draw on your Wiza email and phone credits; credits are charged only for found results.",
    ],
    links: [
      { label: "Wiza API docs", url: "https://docs.wiza.co/" },
    ],
  },
  gong: {
    useCases: [
      "Pull the summary of an intake call to brief an agent on the role",
      "Use call transcripts to capture exactly what the hiring manager asked for",
    ],
    whatYouNeed: ["A Gong account; an admin creates the API access key"],
    connectionOptions: [
      "The key field is `access-key:secret` — a Gong admin generates both under company settings → Ecosystem → API.",
    ],
  },
  snov: {
    useCases: [
      "Find verified work emails for a list of candidates",
      "Build and verify a contactable outreach list",
    ],
    connectionOptions: [
      "The key field is `client-id:client-secret` — both are shown in Snov.io under account settings → API.",
    ],
  },
  replyio: {
    capabilities: [
      "List your multichannel outreach sequences and their status",
      "List and look up contacts already in Reply.io",
    ],
    useCases: [
      "Check which candidates or clients are already in an outreach sequence before contacting them again",
      "Pull a contact's details and engagement context from Reply.io into a task",
      "Review sequence status and health to brief on an outreach campaign",
    ],
    whatYouNeed: ["A Reply.io account with API access"],
    steps: [
      "In Reply.io, open Settings → API key and copy your key.",
      "In Calyflow, go to Settings → Connectors → Reply.io and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your sequences and contacts and never sends or edits outreach in Reply.io.",
    ],
    links: [
      { label: "Reply.io API docs", url: "https://docs.reply.io/api-reference/introduction" },
    ],
  },
};

export interface ConnectorDoc {
  connector: Connector;
  provider: string;
  category: ConnectorCategory;
  categoryLabel: string;
  faviconUrl?: string;
  authLabel: "One-click OAuth" | "Bring-your-own OAuth" | "API key";
  capabilities: string[];
  useCases: string[];
  whatYouNeed: string[];
  /** Markdown/plain steps for connecting (authored, else from catalog hints). */
  steps: string[];
  connectionOptions: string[];
  configuration: string[];
  apiKeyPlaceholder?: string;
  links: { label: string; url: string }[];
  selfHost: SelfHostSetup | null;
}

/** Live connectors that have a provider id (everything we can document + link). */
export function listLiveConnectors(): Connector[] {
  return CONNECTORS.filter((c) => c.live && c.provider);
}

function fill(lines: string[], name: string): string[] {
  return lines.map((l) => l.replace(/\{name\}/g, name));
}

/** Merge the catalog entry, authored content, per-category defaults, and
 *  self-host setup for one connector. Returns null if not a live connector. */
export function getConnectorDoc(provider: string): ConnectorDoc | null {
  const connector = CONNECTORS.find((c) => c.provider === provider && c.live);
  if (!connector) return null;
  const authored = DOC_CONNECTORS[provider] ?? {};

  const authLabel: ConnectorDoc["authLabel"] =
    connector.auth === "oauth"
      ? connector.byoOAuth
        ? "Bring-your-own OAuth"
        : "One-click OAuth"
      : "API key";

  // Steps fall back to the catalog's one-line hints so every page is useful.
  const steps =
    authored.steps ??
    (connector.auth === "apikey"
      ? [
          connector.apiKeyHint ??
            `Create an API key in your ${connector.name} account, then paste it in Calyflow under Settings → Connectors → ${connector.name}.`,
        ]
      : connector.byoOAuth
        ? [
            connector.oauthAppHint ??
              `Register an OAuth app in ${connector.name}, then connect from Settings → Connectors → ${connector.name}.`,
          ]
        : [
            `Open Settings → Connectors → ${connector.name} and click Connect, then sign in to ${connector.name} and approve access.`,
          ]);

  // Connection options fall back to the API-key format hint when there is one.
  const connectionOptions =
    authored.connectionOptions ??
    (connector.apiKeyPlaceholder
      ? [
          `The key is entered in the format \`${connector.apiKeyPlaceholder}\` — ${connector.apiKeyHint ?? "see your account's API settings"}.`,
        ]
      : []);

  const domain = connector.provider
    ? CONNECTOR_DOMAINS[connector.provider]
    : undefined;

  return {
    connector,
    provider,
    category: connector.category,
    categoryLabel: CONNECTOR_CATEGORY_LABELS[connector.category],
    faviconUrl: connectorFaviconUrl(domain),
    authLabel,
    capabilities: authored.capabilities ?? [connector.blurb],
    useCases: authored.useCases ?? CATEGORY_USE_CASES[connector.category],
    whatYouNeed:
      authored.whatYouNeed ??
      [`A ${connector.name} account${connector.auth === "apikey" ? " with permission to create an API key" : ""}.`],
    steps,
    connectionOptions,
    configuration: fill(
      authored.configuration ?? CATEGORY_CONFIG[connector.category],
      connector.name,
    ),
    apiKeyPlaceholder: connector.apiKeyPlaceholder,
    links: authored.links ?? [],
    selfHost: getSelfHostSetup(provider, connector.auth),
  };
}
