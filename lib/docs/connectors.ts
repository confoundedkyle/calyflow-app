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
  recruitcrm: {
    capabilities: [
      "Search candidates (name, email, phone, position)",
      "List jobs with their company, status, and city",
    ],
    useCases: [
      "Pull a candidate's contact details from your ATS into a task",
      "Check which jobs are open before sourcing against them",
      "Search your candidate database by keyword from an agent",
    ],
    whatYouNeed: ["A Recruit CRM account with API access"],
    steps: [
      "In Recruit CRM, go to Settings → API & Webhooks and generate an API key.",
      "In Calyflow, go to Settings → Connectors → Recruit CRM and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads candidates and jobs and never edits records in Recruit CRM.",
    ],
    links: [
      { label: "Recruit CRM API docs", url: "https://docs.recruitcrm.io/" },
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
  affinity: {
    capabilities: [
      "Search people and the companies (organizations) in your Affinity CRM",
      "List deals (opportunities) in your pipeline",
    ],
    useCases: [
      "Brief yourself on a client or candidate before a call using their Affinity record",
      "Find the right contact at a target company for business development",
      "Check warm relationships and open deals before working a new account",
    ],
    whatYouNeed: ["An Affinity account with permission to create an API key"],
    steps: [
      "In Affinity, go to Settings → API and create an API key.",
      "In Calyflow, go to Settings → Connectors → Affinity and paste the key.",
    ],
    configuration: [
      "Read-only: Calyflow searches Affinity for the people, companies, and deals a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Affinity API docs", url: "https://api-docs.affinity.co/" },
    ],
  },
  capsule: {
    capabilities: [
      "Search people and client companies (parties)",
      "List deals (opportunities) with their value and milestone",
    ],
    useCases: [
      "Brief yourself on a client account before a call using its Capsule record",
      "Find the right contact at a target company for outreach",
      "Prioritise which roles to work first based on open opportunities",
    ],
    whatYouNeed: ["A Capsule account with permission to create an API token"],
    steps: [
      "In Capsule, go to My Preferences → API Authentication Tokens and generate a token.",
      "In Calyflow, go to Settings → Connectors → Capsule and paste the token.",
    ],
    configuration: [
      "Read-only: Calyflow searches Capsule for the people, companies, and deals a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Capsule API docs", url: "https://developer.capsulecrm.com/" },
    ],
  },
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
  copper: {
    capabilities: [
      "Search people, client companies, and deals (opportunities)",
      "Pull BD pipeline context into research and outreach",
    ],
    useCases: [
      "Brief yourself on a client account before a call using its Copper record",
      "Find the right contact at a target company for outreach",
      "Prioritise which roles to work first based on open opportunities",
    ],
    whatYouNeed: ["A Copper account, and the email of the user who created the API key"],
    steps: [
      "In Copper, go to Settings → Integrations → API Keys and generate a key.",
      "In Calyflow, go to Settings → Connectors → Copper and paste it as email:api-key (the email of the user who generated the key).",
    ],
    configuration: [
      "Read-only: Calyflow searches Copper for the people, companies, and deals a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Copper API docs", url: "https://developer.copper.com/" },
    ],
  },
  serpapi: {
    capabilities: [
      "Run a Google search and read the organic results (title, snippet, link)",
    ],
    useCases: [
      'X-ray source candidates, e.g. site:linkedin.com/in "React" "Berlin"',
      "Find a candidate's public profiles, talks, or portfolio across the web",
      "Research a target company before a BD outreach",
    ],
    whatYouNeed: ["A SerpApi account with an API key"],
    steps: [
      "In SerpApi, open Your Account → API Key and copy your private key.",
      "In Calyflow, go to Settings → Connectors → SerpApi and paste it.",
    ],
    configuration: [
      "Each search draws on your SerpApi search quota; results mirror a live Google search.",
    ],
    links: [
      { label: "SerpApi docs", url: "https://serpapi.com/search-api" },
    ],
  },
  salesflare: {
    capabilities: [
      "Search contacts and accounts (client companies)",
      "List deals (opportunities) with their value and status",
    ],
    useCases: [
      "Brief yourself on a client account before a call using its Salesflare record",
      "Find the right contact at a target company for outreach",
      "Prioritise which roles to work first based on open opportunities",
    ],
    whatYouNeed: ["A Salesflare account with permission to create an API key"],
    steps: [
      "In Salesflare, go to Settings → API key and create a key.",
      "In Calyflow, go to Settings → Connectors → Salesflare and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow searches Salesflare for the contacts, accounts, and deals a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Salesflare API docs", url: "https://api.salesflare.com/docs" },
    ],
  },
  "zendesk-sell": {
    capabilities: [
      "Search people and client companies (contacts)",
      "List deals in the BD pipeline",
    ],
    useCases: [
      "Brief yourself on a client account before a call using its Zendesk Sell record",
      "Find the right contact at a target company for outreach",
      "Prioritise which roles to work first based on open deals",
    ],
    whatYouNeed: ["A Zendesk Sell account with permission to create an access token"],
    steps: [
      "In Zendesk Sell, go to Settings → OAuth → Access Tokens and add a token.",
      "In Calyflow, go to Settings → Connectors → Zendesk Sell and paste the token.",
    ],
    configuration: [
      "Read-only: Calyflow searches Zendesk Sell for the contacts and deals a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Zendesk Sell API", url: "https://developer.zendesk.com/api-reference/sales-crm/introduction/" },
    ],
  },
  insightly: {
    capabilities: [
      "List contacts and client organisations",
      "List deals (opportunities) with their value and state",
    ],
    useCases: [
      "Brief yourself on a client account before a call using its Insightly record",
      "Find the right contact at a target company for outreach",
      "Prioritise which roles to work first based on open opportunities",
    ],
    whatYouNeed: ["An Insightly account (your per-user API key and its pod/region)"],
    steps: [
      "In Insightly, open User Settings → API to find your API key and its URL (e.g. api.na1.insightly.com — the 'na1' is your pod).",
      "In Calyflow, go to Settings → Connectors → Insightly and paste it as pod:api-key.",
    ],
    configuration: [
      "Read-only: Calyflow reads the contacts, companies, and deals a task needs and never changes your CRM data.",
    ],
    links: [
      { label: "Insightly API docs", url: "https://api.na1.insightly.com/v3.1/" },
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
  aircall: {
    capabilities: [
      "List the call log (direction, status, duration, number)",
      "List your Aircall contacts",
    ],
    useCases: [
      "Review screening-call activity for a candidate's number",
      "Check the call history before following up with a candidate",
      "Pull a contact's details from Aircall into a task",
    ],
    whatYouNeed: ["An Aircall account with an API key (API ID + token)"],
    steps: [
      "In Aircall, go to Settings → Integrations & API → API Keys and create a key.",
      "In Calyflow, go to Settings → Connectors → Aircall and paste it as api-id:api-token.",
    ],
    configuration: [
      "Read-only: Calyflow reads your call log and contacts and never places calls or edits anything in Aircall.",
    ],
    links: [
      { label: "Aircall API docs", url: "https://developer.aircall.io/api-references/" },
    ],
  },
  discord: {
    capabilities: [
      "List the channels of a Discord server",
      "Read recent messages in a channel (author, message, sent)",
    ],
    useCases: [
      "Read activity in a talent-community server to spot engaged candidates",
      "Catch up on a channel's recent discussion before reaching out",
      "Pull message history for context when briefing an agent",
    ],
    whatYouNeed: ["A Discord bot token, with the bot invited to your server"],
    steps: [
      "At discord.com/developers, create an application, add a Bot, and copy its token.",
      "Invite the bot to your server with read access, then paste the token in Calyflow under Settings → Connectors → Discord.",
    ],
    configuration: [
      "Read-only: Calyflow reads channels and messages and never posts to Discord. The bot only sees servers and channels it has been given access to.",
    ],
    links: [
      { label: "Discord API docs", url: "https://discord.com/developers/docs/reference" },
    ],
  },
  messagebird: {
    capabilities: [
      "List the SMS history (direction, from, to, body, sent)",
    ],
    useCases: [
      "Review the text history with a candidate before following up",
      "Check whether a candidate replied to an SMS",
      "Pull recent messages for context when briefing an agent",
    ],
    whatYouNeed: ["A MessageBird (Bird) account with a live API access key"],
    steps: [
      "In MessageBird/Bird, go to Developers → API access and copy a live Access Key.",
      "In Calyflow, go to Settings → Connectors → MessageBird and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your message history and never sends SMS from MessageBird.",
    ],
    links: [
      { label: "MessageBird API docs", url: "https://developers.messagebird.com/api/" },
    ],
  },
  telegram: {
    capabilities: [
      "Read recent messages received by your Telegram bot and its groups",
    ],
    useCases: [
      "Catch up on activity in a candidate-community group your bot is in",
      "Read recent messages sent to your recruiting bot",
      "Pull recent chatter for context when briefing an agent",
    ],
    whatYouNeed: ["A Telegram bot token from @BotFather"],
    steps: [
      "In Telegram, message @BotFather, create a bot, and copy the token it gives you.",
      "In Calyflow, go to Settings → Connectors → Telegram and paste the token.",
    ],
    configuration: [
      "Read-only: Calyflow reads recent updates and never sends messages. To see group messages, add the bot to the group and disable its privacy mode in @BotFather.",
    ],
    links: [
      { label: "Telegram Bot API docs", url: "https://core.telegram.org/bots/api" },
    ],
  },
  twilio: {
    capabilities: [
      "List the SMS history with a candidate or number",
      "List the call history (status, direction, duration)",
    ],
    useCases: [
      "Review the text history with a candidate before following up",
      "Check whether a candidate replied to an outreach text",
      "Pull the call log for a number to see screening-call activity",
    ],
    whatYouNeed: ["A Twilio account (Account SID + Auth Token from the Console)"],
    steps: [
      "Open your Twilio Console dashboard and copy the Account SID (starts with AC) and Auth Token.",
      "In Calyflow, go to Settings → Connectors → Twilio and paste them as account-sid:auth-token.",
    ],
    configuration: [
      "Read-only: Calyflow reads your message and call logs and never sends texts or places calls.",
    ],
    links: [
      { label: "Twilio API docs", url: "https://www.twilio.com/docs/messaging/api" },
    ],
  },
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
  emailable: {
    capabilities: [
      "Verify whether an email is deliverable, with a reason and a typo suggestion",
    ],
    useCases: [
      "Verify a candidate's email before adding it to an outreach run",
      "Catch a likely typo in a hand-entered address before sending",
      "Clean a list of emails to protect sender deliverability",
    ],
    whatYouNeed: ["An Emailable account with API access"],
    steps: [
      "In Emailable, open the dashboard → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Emailable and paste it.",
    ],
    configuration: [
      "Each verification draws on your Emailable credits; returns deliverable / undeliverable / risky / unknown plus a reason and any did-you-mean suggestion.",
    ],
    links: [
      { label: "Emailable API docs", url: "https://emailable.com/docs/api/" },
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
  zoom: {
    capabilities: [
      "List your Zoom cloud recordings in a date window",
      "Read the transcript of a recorded interview or intake call",
    ],
    useCases: [
      "Pull the transcript of a candidate interview to write up a scorecard",
      "Capture exactly what a hiring manager asked for from the intake call recording",
      "Review a screening call without re-watching the recording",
    ],
    whatYouNeed: [
      "A Zoom account with cloud recording, and admin rights to build a Server-to-Server OAuth app",
    ],
    steps: [
      "In the Zoom Marketplace, build a Server-to-Server OAuth app and add the cloud_recording:read and user:read scopes.",
      "Copy its Account ID, Client ID, and Client Secret.",
      "In Calyflow, go to Settings → Connectors → Zoom and paste them as account-id:client-id:client-secret.",
    ],
    configuration: [
      "Read-only: Calyflow reads your cloud recordings and transcripts and never changes anything in Zoom. Transcripts exist only for meetings recorded with audio transcription enabled.",
    ],
    links: [
      { label: "Zoom Server-to-Server OAuth", url: "https://developers.zoom.us/docs/internal-apps/s2s-oauth/" },
    ],
  },
  grain: {
    capabilities: [
      "List your Grain recordings with their dates and links",
      "Read the speaker-attributed transcript of a recording",
    ],
    useCases: [
      "Pull the transcript of a candidate interview to write up a scorecard",
      "Capture exactly what a hiring manager asked for from an intake call",
      "Review a screening call without re-watching the recording",
    ],
    whatYouNeed: ["A Grain account with API access"],
    steps: [
      "In Grain, go to Settings → Integrations → Grain API and create a Personal Access Token.",
      "In Calyflow, go to Settings → Connectors → Grain and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your recordings and transcripts and never changes anything in Grain.",
    ],
    links: [
      { label: "Grain API docs", url: "https://developers.grain.com/" },
    ],
  },
  prospeo: {
    capabilities: [
      "Find a verified work email from a name + company website, or a LinkedIn URL",
      "Find a direct mobile number from a LinkedIn profile",
    ],
    useCases: [
      "Find a verified email for a sourced candidate before reaching out",
      "Get a direct mobile number for a candidate from their LinkedIn profile",
      "Enrich a thin lead into a reachable contact for BD outreach",
    ],
    whatYouNeed: ["A Prospeo account with API access"],
    steps: [
      "In Prospeo, open Settings → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Prospeo and paste it.",
    ],
    configuration: [
      "Lookups are synchronous and draw on your Prospeo credits; a verified-email search only charges a credit when a verified email is found.",
    ],
    links: [
      { label: "Prospeo API docs", url: "https://prospeo.io/api-docs" },
    ],
  },
  klenty: {
    capabilities: [
      "List the sales cadences (outreach sequences) in the account",
      "Look up a prospect by email and see their status",
    ],
    useCases: [
      "Check whether a candidate is already in an outreach cadence before contacting them again",
      "Pull a prospect's status and details from Klenty into a task",
      "Review which cadences are running before adding people",
    ],
    whatYouNeed: ["A Klenty account with API access, and the user email the key belongs to"],
    steps: [
      "In Klenty, go to Settings → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Klenty and paste it as your-login-email:api-key.",
    ],
    configuration: [
      "Read-only: Calyflow reads your cadences and prospects and never sends or edits outreach in Klenty.",
    ],
    links: [
      { label: "Klenty API docs", url: "https://support.klenty.com/en/articles/3197537-getting-started-with-klenty-api" },
    ],
  },
  leadmagic: {
    capabilities: [
      "Find a verified work email from a name and company",
      "Verify whether an email address is deliverable",
    ],
    useCases: [
      "Find the likely work email for a sourced candidate, paying only for valid hits",
      "Verify a list of emails before a campaign to protect deliverability",
      "Enrich a thin lead into a reachable contact for BD outreach",
    ],
    whatYouNeed: ["A LeadMagic account with API access"],
    steps: [
      "In LeadMagic, open Settings → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → LeadMagic and paste it.",
    ],
    configuration: [
      "Lookups are synchronous; the email finder charges a credit only when a valid email is found.",
    ],
    links: [
      { label: "LeadMagic API docs", url: "https://docs.leadmagic.io/" },
    ],
  },
  adzuna: {
    capabilities: [
      "Search live job postings by title, location, and salary",
      "Get the salary distribution for a role for benchmarking",
    ],
    useCases: [
      "Benchmark a role's salary before advising a client on a range",
      "Gauge live market demand and competitor postings for a role",
      "Map where a skill is being hired across regions",
    ],
    whatYouNeed: ["An Adzuna developer account (a free app_id + app_key)"],
    steps: [
      "Register at developer.adzuna.com to get an app_id and app_key.",
      "In Calyflow, go to Settings → Connectors → Adzuna and paste them as app-id:app-key.",
    ],
    configuration: [
      "Read-only public job-market data; defaults to the UK (gb) but supports many country codes (us, au, ca, de, fr, …).",
    ],
    links: [
      { label: "Adzuna API docs", url: "https://developer.adzuna.com/" },
    ],
  },
  bouncer: {
    capabilities: [
      "Verify whether an email address is deliverable, with a reason",
    ],
    useCases: [
      "Verify a candidate's email before adding it to an outreach run",
      "Clean a list of emails to protect sender deliverability",
      "Check a risky-looking address before sending",
    ],
    whatYouNeed: ["A Bouncer account with API access"],
    steps: [
      "In Bouncer, open your account → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Bouncer and paste it.",
    ],
    configuration: [
      "Each verification draws on your Bouncer credits; returns deliverable / undeliverable / risky / unknown plus a reason.",
    ],
    links: [
      { label: "Bouncer API docs", url: "https://docs.usebouncer.com/" },
    ],
  },
  calcom: {
    capabilities: [
      "List booked meetings with their times, status, and attendees",
    ],
    useCases: [
      "Check which candidate interviews are booked this week",
      "See who booked a screening call (attendee name and email)",
      "Confirm a candidate booked a slot before prepping for it",
    ],
    whatYouNeed: ["A Cal.com account with API access"],
    steps: [
      "In Cal.com, go to Settings → Developer → API keys and create a key (it starts with cal_).",
      "In Calyflow, go to Settings → Connectors → Cal.com and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your bookings and their attendees and never books or changes anything in Cal.com.",
    ],
    links: [
      { label: "Cal.com API docs", url: "https://cal.com/docs/api-reference/v2/introduction" },
    ],
  },
  calendly: {
    capabilities: [
      "List booked interview events with their times and status",
      "See who booked an event (invitee name and email)",
    ],
    useCases: [
      "Check which candidate interviews are booked this week",
      "Pull the invitee details for a scheduled screening call",
      "Confirm a candidate booked the slot before prepping for it",
    ],
    whatYouNeed: ["A Calendly account with API access"],
    steps: [
      "In Calendly, go to Integrations → API & Webhooks → Personal access tokens and create a token.",
      "In Calyflow, go to Settings → Connectors → Calendly and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your scheduled events and their invitees and never books or changes anything in Calendly.",
    ],
    links: [
      { label: "Calendly API docs", url: "https://developer.calendly.com/" },
    ],
  },
  millionverifier: {
    capabilities: [
      "Verify whether an email address is deliverable, with a quality label",
    ],
    useCases: [
      "Verify a candidate's email before adding it to an outreach run",
      "Clean a list of emails cheaply in bulk to protect sender deliverability",
      "Catch disposable or catch-all addresses before sending",
    ],
    whatYouNeed: ["A MillionVerifier account with API access"],
    steps: [
      "In MillionVerifier, open your account → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → MillionVerifier and paste it.",
    ],
    configuration: [
      "Each verification draws on your MillionVerifier credits; returns ok / catch_all / unknown / disposable / invalid.",
    ],
    links: [
      { label: "MillionVerifier API docs", url: "https://developer.millionverifier.com/" },
    ],
  },
  neverbounce: {
    capabilities: [
      "Verify whether an email address is deliverable",
    ],
    useCases: [
      "Verify a candidate's email before adding it to an outreach run",
      "Clean a list of emails to protect sender deliverability",
      "Catch disposable or catch-all addresses before sending",
    ],
    whatYouNeed: ["A NeverBounce account with API access"],
    steps: [
      "In NeverBounce, open your account → Apps → Custom Integration and copy your API key (starts with secret_).",
      "In Calyflow, go to Settings → Connectors → NeverBounce and paste it.",
    ],
    configuration: [
      "Each verification draws on your NeverBounce credits; returns valid / invalid / disposable / catchall / unknown.",
    ],
    links: [
      { label: "NeverBounce API docs", url: "https://developers.neverbounce.com/" },
    ],
  },
  nymeria: {
    capabilities: [
      "Enrich a person's emails and mobile from a LinkedIn URL or email",
    ],
    useCases: [
      "Turn a sourced LinkedIn profile into a contactable email and phone",
      "Find a direct mobile for a candidate before a calling campaign",
      "Fill in a missing work email from a personal email you already have",
    ],
    whatYouNeed: ["A Nymeria account with API access"],
    steps: [
      "In Nymeria, open Settings → API keys and copy your key.",
      "In Calyflow, go to Settings → Connectors → Nymeria and paste it.",
    ],
    configuration: [
      "Lookups are synchronous and draw on your Nymeria credits; a credit is charged when a match is found.",
    ],
    links: [
      { label: "Nymeria API docs", url: "https://www.nymeria.io/developers" },
    ],
  },
  mailshake: {
    capabilities: [
      "List your cold-email campaigns",
      "List the recipients of a campaign",
    ],
    useCases: [
      "Check which candidates or clients are already in an outreach campaign",
      "Review a campaign's recipient list before adding more",
      "Avoid double-contacting someone already in a sequence",
    ],
    whatYouNeed: ["A Mailshake account with API access"],
    steps: [
      "In Mailshake, open Extensions → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Mailshake and paste it.",
    ],
    configuration: [
      "Read-only: Calyflow reads your campaigns and recipients and never sends or edits outreach in Mailshake.",
    ],
    links: [
      { label: "Mailshake API docs", url: "https://docs.mailshake.com/category/171-api" },
    ],
  },
  zerobounce: {
    capabilities: [
      "Verify whether an email address is deliverable, with a status reason",
    ],
    useCases: [
      "Verify a candidate's email before adding it to an outreach run",
      "Clean a list of emails to protect sender deliverability",
      "Check a risky-looking address (catch-all, role, disposable) before sending",
    ],
    whatYouNeed: ["A ZeroBounce account with API access"],
    steps: [
      "In ZeroBounce, open your account → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → ZeroBounce and paste it.",
    ],
    configuration: [
      "Each verification draws on your ZeroBounce credits; returns valid / invalid / catch-all / unknown / spamtrap / abuse / do_not_mail plus a sub-status.",
    ],
    links: [
      { label: "ZeroBounce API docs", url: "https://www.zerobounce.net/docs/" },
    ],
  },
  stackexchange: {
    capabilities: [
      "Search Stack Exchange users by name, ranked by reputation",
      "List the top answerers for a skill tag to source developers",
    ],
    useCases: [
      "Source strong developers for a technology by its top Stack Overflow answerers",
      "Look up a candidate's Stack Overflow profile and reputation",
      "Build a shortlist of experts in a niche skill (e.g. rust, kubernetes)",
    ],
    whatYouNeed: ["A Stack Apps API key (free; raises your daily request quota)"],
    steps: [
      "Register an app at stackapps.com to get a key.",
      "In Calyflow, go to Settings → Connectors → Stack Exchange and paste it.",
    ],
    configuration: [
      "Read-only public profile data (no contact details); defaults to stackoverflow but supports other Stack Exchange sites. Pair with an enrichment connector to find contact info for sourced people.",
    ],
    links: [
      { label: "Stack Exchange API docs", url: "https://api.stackexchange.com/docs" },
    ],
  },
  tomba: {
    capabilities: [
      "Find a verified work email from a name and company domain",
      "Verify whether an email address is deliverable",
    ],
    useCases: [
      "Find the likely work email for a sourced candidate, with a confidence score",
      "Verify a list of emails before a campaign to protect deliverability",
      "Enrich a thin lead into a reachable contact for BD outreach",
    ],
    whatYouNeed: ["A Tomba account with API access (a key and a secret)"],
    steps: [
      "In Tomba, open Settings → API and copy your key (ta_…) and secret (ts_…).",
      "In Calyflow, go to Settings → Connectors → Tomba and paste them as key:secret.",
    ],
    configuration: [
      "Lookups are synchronous and draw on your Tomba credits; the finder returns a confidence score.",
    ],
    links: [
      { label: "Tomba API docs", url: "https://docs.tomba.io/" },
    ],
  },
  trestle: {
    capabilities: [
      "Validate a phone number — valid/invalid, line type, carrier, and activity",
    ],
    useCases: [
      "Check a candidate's number is a reachable mobile before a calling campaign",
      "Filter out disconnected or VOIP numbers from a list",
      "Identify the carrier and line type for a contact number",
    ],
    whatYouNeed: ["A Trestle account with API access"],
    steps: [
      "In Trestle, open your account → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Trestle and paste it.",
    ],
    configuration: [
      "Each lookup draws on your Trestle credits; the activity score (0–100) reflects recent activity on the number.",
    ],
    links: [
      { label: "Trestle API docs", url: "https://docs.trestleiq.com/" },
    ],
  },
  surfe: {
    capabilities: [
      "Enrich a contact's work email and mobile number",
      "Enrich from a name + company or a LinkedIn profile",
    ],
    useCases: [
      "Turn a sourced LinkedIn profile into a contactable email and mobile",
      "Find a direct mobile for a candidate before a calling campaign",
      "Enrich a thin lead into a reachable contact for BD outreach",
    ],
    whatYouNeed: ["A Surfe account with API access"],
    steps: [
      "In Surfe, open Settings → API and copy your API key.",
      "In Calyflow, go to Settings → Connectors → Surfe and paste it.",
    ],
    configuration: [
      "Enrichment is asynchronous: a request is submitted, then the result is fetched a few seconds later — agents handle this automatically.",
      "Surfe bills separate email and mobile credits; a credit is used when a match is found.",
    ],
    links: [
      { label: "Surfe API docs", url: "https://developers.surfe.com/" },
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
  skrapp: {
    capabilities: [
      "Find a verified work email from a name and company domain",
    ],
    useCases: [
      "Find the likely work email for a sourced candidate, with a quality signal",
      "Turn a name + company into a reachable contact for outreach",
      "Enrich a thin lead before adding it to a sequence",
    ],
    whatYouNeed: ["A Skrapp account on a premium plan (API access is premium-only)"],
    steps: [
      "In Skrapp, open Settings → API and copy your access key.",
      "In Calyflow, go to Settings → Connectors → Skrapp and paste it.",
    ],
    configuration: [
      "Lookups are synchronous and draw on your Skrapp email credits; results include a quality signal.",
    ],
    links: [
      { label: "Skrapp API docs", url: "https://skrapp.io/api" },
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
