// Connector catalog — mirrors aiwithmichal.com/store/skills. Activation is
// not built yet; cards render with disabled buttons until each connector ships.

export type ConnectorCategory =
  | "ats"
  | "crm"
  | "data"
  | "email"
  | "comms"
  | "tool";

export interface Connector {
  name: string;
  category: ConnectorCategory;
  blurb: string;
  /** Provider id matching workspace_connections.provider + the adapter registry.
   *  Present only for connectors with a working backend. */
  provider?: string;
  /** True when the connector can actually be activated (has an adapter). */
  live?: boolean;
  /** Built-in, keyless capability (e.g. DuckDuckGo web search): always on, no
   *  connection to make. Renders as "Built in" with no Connect affordance and is
   *  exempt from the credential-adapter requirement. */
  builtin?: boolean;
  /** How the connector authenticates — drives the Connect affordance. */
  auth?: "oauth" | "apikey";
  /** Additional categories this connector also belongs to, beyond its primary
   *  `category` (which drives the badge). A dual-purpose ATS + CRM lists here so
   *  it's filterable and pickable under each. */
  extraCategories?: ConnectorCategory[];
  /** OAuth connectors where each workspace registers its OWN OAuth app and
   *  pastes the client_id/secret here (e.g. Vincere issues client_ids per
   *  customer instance, so a shared env app can't authorize every tenant).
   *  Drives a credentials form before the OAuth redirect. */
  byoOAuth?: boolean;
  /** Help text under the BYO OAuth credential form: where to register the app. */
  oauthAppHint?: string;
  /** Input placeholder for non-obvious credential formats (e.g. "subdomain:api-key"). */
  apiKeyPlaceholder?: string;
  /** One-line help shown under the open API-key input: format + where to find it. */
  apiKeyHint?: string;
}

export const CONNECTOR_CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  ats: "ATS",
  crm: "CRM",
  data: "Data",
  email: "Email",
  comms: "Comms",
  tool: "Tool",
};

export const CONNECTORS: Connector[] = [
  // ATS
  { name: "Ashby", category: "ats", blurb: "Sync roles and candidates from the analytics-first modern ATS.", provider: "ashby", live: true, auth: "apikey" },
  { name: "BambooHR", category: "ats", blurb: "Import applicants from the SMB-favorite HR platform's ATS.", provider: "bamboohr", live: true, auth: "apikey", apiKeyPlaceholder: "company-domain:api-key", apiKeyHint: "The company domain is the {company} part of {company}.bamboohr.com; create the key from your avatar menu → API Keys." },
  { name: "BreezyHR", category: "ats", blurb: "Pull pipelines from the visual drag-and-drop hiring tool.", provider: "breezyhr", live: true, auth: "apikey" },
  { name: "Bullhorn", category: "ats", blurb: "Sync candidates, jobs, and submissions from the agency staffing standard.", provider: "bullhorn", live: true, auth: "oauth" },
  { name: "CATS", category: "ats", blurb: "Pull jobs and candidates from the veteran agency ATS.", provider: "cats", live: true, auth: "apikey" },
  { name: "Crelate", category: "ats", blurb: "Pull contacts and jobs from the executive-search favorite ATS + CRM.", provider: "crelate", live: true, auth: "apikey", apiKeyHint: "Enable and copy the key in Crelate under Settings → My Settings & Preferences → API Key." },
  { name: "Greenhouse", category: "ats", blurb: "Sync jobs and candidates from the enterprise hiring standard.", provider: "greenhouse", live: true, auth: "apikey" },
  { name: "JazzHR", category: "ats", blurb: "Import candidates from the SMB-friendly recruiting software.", provider: "jazzhr", live: true, auth: "apikey" },
  { name: "JobAdder", category: "ats", blurb: "Sync candidates, jobs, and pipelines from the ANZ/UK agency favorite.", provider: "jobadder", live: true, auth: "oauth" },
  { name: "Jobin Cloud", category: "ats", extraCategories: ["crm"], blurb: "Search your Jobin Cloud candidate database and read your outreach campaigns.", provider: "jobin-cloud", live: true, auth: "apikey", apiKeyHint: "Create a key in Jobin.cloud under Workgroups → Integrations → Custom integration, and paste it here." },
  { name: "Lever", category: "ats", blurb: "Sync pipelines from the CRM-style ATS teams love.", provider: "lever", live: true, auth: "apikey" },
  { name: "Loxo", category: "ats", blurb: "Pull candidates from the AI recruiting platform for agencies.", provider: "loxo", live: true, auth: "apikey", apiKeyPlaceholder: "agency-slug:api-key", apiKeyHint: "The slug is the subdomain in your Loxo URL ({slug}.app.loxo.co); keys live in Settings → API Keys (Open API access is a paid Loxo feature)." },
  { name: "Manatal", category: "ats", blurb: "Import candidates from the affordable AI-recommendation ATS.", provider: "manatal", live: true, auth: "apikey" },
  { name: "Pinpoint", category: "ats", blurb: "Sync roles from the in-house talent acquisition platform.", provider: "pinpoint", live: true, auth: "apikey", apiKeyPlaceholder: "subdomain:api-key", apiKeyHint: "The subdomain is your Pinpoint URL ({subdomain}.pinpointhq.com); keys are created under Company settings → API keys." },
  { name: "Recruit CRM", category: "ats", extraCategories: ["crm"], blurb: "Search candidates and jobs from the agency ATS + CRM.", provider: "recruitcrm", live: true, auth: "apikey", apiKeyHint: "Generate an API key in Recruit CRM under Settings → API & Webhooks." },
  { name: "Recruitee", category: "ats", blurb: "Pull collaborative hiring pipelines straight into your projects.", provider: "recruitee", live: true, auth: "apikey", apiKeyPlaceholder: "company-id:token", apiKeyHint: "Both are shown in Recruitee under Settings → Apps and plugins → Personal API tokens (the company ID is the number next to your token)." },
  { name: "Recruiterflow", category: "ats", blurb: "Sync the ATS + CRM built for recruiting firms.", provider: "recruiterflow", live: true, auth: "apikey" },
  { name: "Recruitis", category: "ats", blurb: "Pull jobs and candidate pipelines from the recruitment ATS.", provider: "recruitis", live: true, auth: "apikey", apiKeyHint: "Generate a token in Recruitis under Settings → API (it needs the read scopes, e.g. api.position.read and api.candidates.read)." },
  { name: "SmartRecruiters", category: "ats", blurb: "Sync jobs and candidates from the enterprise TA suite.", provider: "smartrecruiters", live: true, auth: "apikey" },
  { name: "Teamtailor", category: "ats", blurb: "Import candidates from the employer-branding-first ATS.", provider: "teamtailor", live: true, auth: "apikey" },
  { name: "Vincere", category: "ats", extraCategories: ["crm"], blurb: "Search candidates, contacts, companies, applications, and talent pools from the recruitment agency ATS + CRM.", provider: "vincere", live: true, auth: "oauth", byoOAuth: true, oauthAppHint: "In Vincere go to Settings → API → API Authentication & Throttling, register an app with the redirect URI shown above, then paste its Client ID here (add a Client Secret only if Vincere issued your app a confidential one)." },
  { name: "Workable", category: "ats", blurb: "Pull jobs and candidates from the all-in-one hiring platform.", provider: "workable", live: true, auth: "apikey" },
  { name: "Zoho Recruit", category: "ats", blurb: "Import candidates from Zoho's staffing-ready ATS.", provider: "zoho-recruit", live: true, auth: "oauth" },

  // CRM
  { name: "Affinity", category: "crm", blurb: "Search people, companies, and deals from the relationship-intelligence CRM for exec search.", provider: "affinity", live: true, auth: "apikey", apiKeyHint: "Create an API key in Affinity under Settings → API." },
  { name: "Attio", category: "crm", blurb: "Query people, companies, and deals from the modern CRM.", provider: "attio", live: true, auth: "apikey" },
  { name: "Capsule", category: "crm", blurb: "Read people, client companies, and deals from the lightweight CRM.", provider: "capsule", live: true, auth: "apikey", apiKeyHint: "Create a Personal Access Token in Capsule under My Preferences → API Authentication Tokens." },
  { name: "Close", category: "crm", blurb: "Read client leads and BD opportunities from the sales-focused CRM.", provider: "close", live: true, auth: "apikey", apiKeyHint: "Create an API key in Close under Settings → Developer → API Keys." },
  { name: "Copper", category: "crm", blurb: "Read people, client companies, and deals from the Google Workspace CRM.", provider: "copper", live: true, auth: "apikey", apiKeyPlaceholder: "email:api-key", apiKeyHint: "Create the key in Copper under Settings → Integrations → API Keys; pair it with the email of the user who generated it." },
  { name: "folk", category: "crm", blurb: "Read the people and client companies from the relationship-first CRM.", provider: "folk", live: true, auth: "apikey", apiKeyHint: "Create an API key in folk under Settings → Workspace → API." },
  { name: "HubSpot", category: "crm", blurb: "Sync client companies, deals, and contacts effortlessly.", provider: "hubspot", live: true, auth: "apikey" },
  { name: "Insightly", category: "crm", blurb: "Read contacts, client companies, and deals from the all-in-one CRM.", provider: "insightly", live: true, auth: "apikey", apiKeyPlaceholder: "pod:api-key", apiKeyHint: "The pod is the region in your API URL under User Settings → API (e.g. the 'na1' in api.na1.insightly.com); paste it with your key as pod:api-key." },
  { name: "monday.com", category: "crm", blurb: "Read the candidate and client boards your agency already runs.", provider: "monday", live: true, auth: "apikey", apiKeyHint: "Copy your personal API token from your monday.com profile picture → Developers → API token." },
  { name: "Notion", category: "crm", blurb: "Read the databases and pages your team already runs recruiting on.", provider: "notion", live: true, auth: "oauth" },
  { name: "Pipedrive", category: "crm", blurb: "Pull your BD pipeline and client deals into Calyflow.", provider: "pipedrive", live: true, auth: "apikey" },
  { name: "Salesflare", category: "crm", blurb: "Read auto-enriched contacts, accounts, and deals from the account-centric CRM.", provider: "salesflare", live: true, auth: "apikey", apiKeyHint: "Create an API key in Salesflare under Settings → API key." },
  { name: "Zendesk Sell", category: "crm", blurb: "Read contacts, client companies, and deals from the Zendesk sales CRM.", provider: "zendesk-sell", live: true, auth: "apikey", apiKeyHint: "Create an access token in Zendesk Sell under Settings → OAuth → Access Tokens." },
  { name: "Zoho CRM", category: "crm", blurb: "Sync clients and deals from Zoho's sales suite.", provider: "zoho-crm", live: true, auth: "oauth" },

  // Data (spreadsheets & flexible databases)
  { name: "Airtable", category: "data", blurb: "Sync the flexible candidate and client bases you already run.", provider: "airtable", live: true, auth: "oauth" },
  { name: "Google Sheets", category: "data", blurb: "Read candidate and client trackers straight from your Google Sheets.", provider: "google-sheets", live: true, auth: "oauth" },
  { name: "Microsoft Excel", category: "data", blurb: "Pull pipelines and lists from Excel workbooks in OneDrive and SharePoint.", provider: "microsoft-excel", live: true, auth: "oauth" },

  // --- Email (sending on the user's behalf, e.g. agent outreach) ---
  { name: "Gmail", category: "email", blurb: "Send candidate outreach from your own Gmail address.", provider: "gmail", live: true, auth: "oauth" },
  { name: "Microsoft Outlook", category: "email", blurb: "Send candidate outreach from your Outlook / Microsoft 365 mailbox.", provider: "microsoft-outlook", live: true, auth: "oauth" },

  // --- Comms (team messaging — where recruiting agents reach hiring managers) ---
  { name: "Aircall", category: "comms", blurb: "Read the call log and contacts from your Aircall phone line.", provider: "aircall", live: true, auth: "apikey", apiKeyPlaceholder: "api-id:api-token", apiKeyHint: "Create an API key in Aircall under Settings → Integrations & API → API Keys; paste the API ID and token separated by a colon." },
  { name: "Discord", category: "comms", blurb: "Read channels and message history from your Discord talent community.", provider: "discord", live: true, auth: "apikey", apiKeyHint: "Create a bot at discord.com/developers, copy its token, and invite it to your server with read access." },
  { name: "MessageBird", category: "comms", blurb: "Read the SMS history with candidates from your MessageBird (Bird) number.", provider: "messagebird", live: true, auth: "apikey", apiKeyHint: "Create a live access key in MessageBird/Bird under Developers → API access (Access Keys)." },
  { name: "Slack", category: "comms", blurb: "Run recruiting agents and receive project reports in your team's Slack — a channel per project.", provider: "slack", live: true, auth: "oauth", oauthAppHint: "Connect in one click with the Calyflow Slack app. Self-hosting? Create your own app at api.slack.com, add the redirect URI shown above, and set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET." },
  { name: "Telegram", category: "comms", blurb: "Read recent messages from your Telegram bot or candidate-community group.", provider: "telegram", live: true, auth: "apikey", apiKeyHint: "Create a bot with @BotFather in Telegram and paste the token it gives you." },
  { name: "Twilio", category: "comms", blurb: "Read the SMS and call history with candidates from your Twilio number.", provider: "twilio", live: true, auth: "apikey", apiKeyPlaceholder: "account-sid:auth-token", apiKeyHint: "Both are on your Twilio Console dashboard; the Account SID starts with AC. Paste them separated by a colon." },

  // Tools (sourcing & outreach)
  { name: "Adzuna", category: "tool", blurb: "Search the job market and salary data for benchmarking and demand signals.", provider: "adzuna", live: true, auth: "apikey", apiKeyPlaceholder: "app-id:app-key", apiKeyHint: "Register for an app_id and app_key at developer.adzuna.com and paste them separated by a colon." },
  { name: "Apollo", category: "tool", blurb: "Source contact data from the 270M-profile B2B database.", provider: "apollo", live: true, auth: "apikey" },
  { name: "Avoma", category: "tool", blurb: "Read transcripts and AI notes from your recorded intake and screening calls.", provider: "avoma", live: true, auth: "apikey", apiKeyHint: "Create a scoped API key in Avoma under Settings → API." },
  { name: "Bouncer", category: "tool", blurb: "Verify email deliverability before reaching out.", provider: "bouncer", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Bouncer under your account → API." },
  { name: "Bright Data", category: "tool", blurb: "Enrich profiles with large-scale public web data.", provider: "brightdata", live: true, auth: "apikey" },
  { name: "Cal.com", category: "tool", blurb: "Read booked meetings and their attendees from the open-source scheduler.", provider: "calcom", live: true, auth: "apikey", apiKeyHint: "Create an API key in Cal.com under Settings → Developer → API keys (it starts with cal_)." },
  { name: "Calendly", category: "tool", blurb: "Read booked interview events and who scheduled them.", provider: "calendly", live: true, auth: "apikey", apiKeyHint: "Create a personal access token in Calendly under Integrations → API & Webhooks → Personal access tokens." },
  { name: "ContactOut", category: "tool", blurb: "Find personal emails and phones behind LinkedIn profiles.", provider: "contactout", live: true, auth: "apikey" },
  { name: "Coresignal", category: "tool", blurb: "Enrich candidates with fresh public employment data.", provider: "coresignal", live: true, auth: "apikey" },
  { name: "Dropcontact", category: "tool", blurb: "Find and verify GDPR-compliant emails for European candidates and clients.", provider: "dropcontact", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Dropcontact under Settings → Your API key (API access requires a paid plan)." },
  { name: "DuckDuckGo", category: "tool", blurb: "Free web search for the agents — no key needed. Used automatically when Firecrawl isn't connected.", provider: "duckduckgo", live: true, builtin: true },
  { name: "Emailable", category: "tool", blurb: "Verify email deliverability, with typo suggestions, before outreach.", provider: "emailable", live: true, auth: "apikey", apiKeyHint: "Copy your API key from the Emailable dashboard → API." },
  { name: "Fathom", category: "tool", blurb: "Read AI summaries and transcripts of your recorded calls.", provider: "fathom", live: true, auth: "apikey" },
  { name: "Findymail", category: "tool", blurb: "Find and verify B2B emails and mobile numbers for candidates and clients.", provider: "findymail", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Findymail at app.findymail.com → API." },
  { name: "Firecrawl", category: "tool", blurb: "Power the agents' web search and clean-markdown page scraping with your own key.", provider: "firecrawl", live: true, auth: "apikey", apiKeyHint: "Copy your API key from firecrawl.dev under Settings → API Keys (it starts with fc-)." },
  { name: "Fireflies.ai", category: "tool", blurb: "Search interview and client-call transcripts and summaries.", provider: "fireflies", live: true, auth: "apikey" },
  { name: "FullEnrich", category: "tool", blurb: "Find verified emails and mobile numbers through a 15+ vendor waterfall.", provider: "fullenrich", live: true, auth: "apikey", apiKeyHint: "Copy your API key from FullEnrich at app.fullenrich.com → API." },
  { name: "GitHub", category: "tool", blurb: "Source engineers from open-source repos — contributors, forkers, and commit-email contacts.", provider: "github", live: true, auth: "apikey", apiKeyHint: "Create a Personal Access Token at github.com → Settings → Developer settings → Personal access tokens (a classic token with the public_repo scope, or a fine-grained read-only token, is enough)." },
  { name: "Gong", category: "tool", blurb: "Read briefs and transcripts from your recorded sales and intake calls.", provider: "gong", live: true, auth: "apikey", apiKeyPlaceholder: "access-key:secret", apiKeyHint: "A Gong admin creates the access-key pair under company settings → Ecosystem → API; paste both parts separated by a colon." },
  { name: "Grain", category: "tool", blurb: "Read transcripts of your recorded interviews and intake calls.", provider: "grain", live: true, auth: "apikey", apiKeyHint: "Create a Personal Access Token in Grain under Settings → Integrations → Grain API." },
  { name: "Hunter.io", category: "tool", blurb: "Find and verify work email addresses instantly.", provider: "hunter", live: true, auth: "apikey" },
  { name: "Instantly.ai", category: "tool", blurb: "Scale cold email outreach with automated warm-up.", provider: "instantly", live: true, auth: "apikey" },
  { name: "Klenty", category: "tool", blurb: "Read sales cadences and prospect status from the outreach platform.", provider: "klenty", live: true, auth: "apikey", apiKeyPlaceholder: "your-login-email:api-key", apiKeyHint: "The key is in Klenty under Settings → API; pair it with the email of the Klenty user it belongs to." },
  { name: "LeadMagic", category: "tool", blurb: "Find and verify B2B emails, paying only for valid results.", provider: "leadmagic", live: true, auth: "apikey", apiKeyHint: "Copy your API key from LeadMagic under Settings → API." },
  { name: "Lemlist", category: "tool", blurb: "Personalised cold outreach sequences that get replies.", provider: "lemlist", live: true, auth: "apikey" },
  { name: "Lusha", category: "tool", blurb: "B2B contact data to reach candidates and clients.", provider: "lusha", live: true, auth: "apikey" },
  { name: "Mailshake", category: "tool", blurb: "Read cold-email campaigns and their recipients for outreach context.", provider: "mailshake", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Mailshake under Extensions → API." },
  { name: "MillionVerifier", category: "tool", blurb: "Verify email deliverability in bulk, cheaply, before outreach.", provider: "millionverifier", live: true, auth: "apikey", apiKeyHint: "Copy your API key from MillionVerifier under your account → API." },
  { name: "NeverBounce", category: "tool", blurb: "Verify email deliverability at scale before outreach.", provider: "neverbounce", live: true, auth: "apikey", apiKeyHint: "Copy your API key from NeverBounce under your account → Apps → Custom Integration (it starts with secret_)." },
  { name: "Nymeria", category: "tool", blurb: "Enrich a person's emails and phone from a LinkedIn profile or email.", provider: "nymeria", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Nymeria under Settings → API keys." },
  { name: "People Data Labs", category: "tool", blurb: "Enrich and search billions of person profiles at scale.", provider: "peopledatalabs", live: true, auth: "apikey" },
  { name: "Prospeo", category: "tool", blurb: "Find verified emails and mobile numbers for candidates and clients.", provider: "prospeo", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Prospeo under Settings → API." },
  { name: "Reply.io", category: "tool", blurb: "Read multichannel outreach sequences and contacts to coordinate candidate and client follow-up.", provider: "replyio", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Reply.io under Settings → API key." },
  { name: "RocketReach", category: "tool", blurb: "Find emails and phones across 700M+ professional profiles.", provider: "rocketreach", live: true, auth: "apikey" },
  { name: "SerpApi", category: "tool", blurb: "Run Google searches for candidate X-ray sourcing.", provider: "serpapi", live: true, auth: "apikey", apiKeyHint: "Copy your private API key from SerpApi under Your Account → API Key." },
  { name: "SignalHire", category: "tool", blurb: "Reveal candidate emails and phones with the recruiter-built contact finder.", provider: "signalhire", live: true, auth: "apikey", apiKeyHint: "Create the key in SignalHire under Integrations & API; the same credit pool is shared with the web app and extension." },
  { name: "Skrapp", category: "tool", blurb: "Find a verified work email from a name and company domain.", provider: "skrapp", live: true, auth: "apikey", apiKeyHint: "Copy your access key from Skrapp under Settings → API (requires a premium plan)." },
  { name: "Smartlead", category: "tool", blurb: "Track cold-email campaigns, leads, and reply analytics.", provider: "smartlead", live: true, auth: "apikey" },
  { name: "Snov.io", category: "tool", blurb: "Find and verify work emails for outreach-ready lists.", provider: "snov", live: true, auth: "apikey", apiKeyPlaceholder: "client-id:client-secret", apiKeyHint: "Both are shown in Snov.io under your account settings → API." },
  { name: "Stack Exchange", category: "tool", blurb: "Source developers by Stack Overflow reputation and top answers per skill.", provider: "stackexchange", live: true, auth: "apikey", apiKeyHint: "Register an app at stackapps.com to get a key (raises your daily quota)." },
  { name: "Surfe", category: "tool", blurb: "Enrich a contact's email and mobile number from a name or LinkedIn profile.", provider: "surfe", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Surfe under Settings → API." },
  { name: "tl;dv", category: "tool", blurb: "Read AI notes and transcripts from your recorded meetings.", provider: "tldv", live: true, auth: "apikey", apiKeyHint: "Create the key under personal settings → API Keys; API access requires the tl;dv Business plan." },
  { name: "Tomba", category: "tool", blurb: "Find and verify B2B emails from a name and company domain.", provider: "tomba", live: true, auth: "apikey", apiKeyPlaceholder: "key:secret", apiKeyHint: "Both are in Tomba under Settings → API (the key starts with ta_, the secret with ts_); paste them separated by a colon." },
  { name: "Trestle", category: "tool", blurb: "Validate phone numbers — line type, carrier, and recent activity.", provider: "trestle", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Trestle under your account → API." },
  { name: "Wiza", category: "tool", blurb: "Reveal verified emails and mobile numbers from LinkedIn profiles.", provider: "wiza", live: true, auth: "apikey", apiKeyHint: "Create an API key in Wiza under Settings → API." },
  { name: "Woodpecker", category: "tool", blurb: "Track cold-email campaigns and prospect replies, EU-style.", provider: "woodpecker", live: true, auth: "apikey", apiKeyHint: "Create the key in Woodpecker under Add-ons → API & Integrations → API keys." },
  { name: "ZeroBounce", category: "tool", blurb: "Verify email deliverability before adding addresses to outreach.", provider: "zerobounce", live: true, auth: "apikey", apiKeyHint: "Copy your API key from ZeroBounce under your account → API." },
  { name: "Zoom", category: "tool", blurb: "Read cloud recordings and transcripts of your interviews and intake calls.", provider: "zoom", live: true, auth: "apikey", apiKeyPlaceholder: "account-id:client-id:client-secret", apiKeyHint: "In the Zoom Marketplace, build a Server-to-Server OAuth app (scopes: cloud_recording:read, user:read) and paste its Account ID, Client ID, and Client Secret separated by colons." },
];

// --- Agent connector requirements -----------------------------------------
// Category-generic agents don't bind to one provider. Their allowed_tools
// carry "connector:<category>" placeholders; the user picks a connected
// provider of that category before each run, and the placeholder expands to
// that provider's tools.

export const CONNECTOR_REQUIREMENT_PREFIX = "connector:";

/** Connector categories an agent needs, derived from its allowed_tools. */
export function requiredConnectorCategories(
  allowedTools: string[],
): ConnectorCategory[] {
  const known = Object.keys(CONNECTOR_CATEGORY_LABELS);
  return allowedTools
    .filter((t) => t.startsWith(CONNECTOR_REQUIREMENT_PREFIX))
    .map((t) => t.slice(CONNECTOR_REQUIREMENT_PREFIX.length))
    .filter((c): c is ConnectorCategory => known.includes(c));
}

/** Provider slugs an agent binds DIRECTLY — its allowed_tools include that
 *  provider's prefixed tools (e.g. "coresignal_search_employees" → "coresignal").
 *  Unlike connector:<category> placeholders the user picks at run time, these are
 *  fixed dependencies and render as a specific connector node on the canvas. */
export function providersFromTools(allowedTools: string[]): string[] {
  const out: string[] = [];
  for (const c of CONNECTORS) {
    if (!c.provider) continue;
    const prefix = providerToolPrefix(c.provider);
    if (allowedTools.some((t) => t.startsWith(prefix))) out.push(c.provider);
  }
  return out;
}

/**
 * Resolve an agent/automation's allowed_tools against a set of connector
 * bindings: drop the `connector:<category>` placeholders and, for each one, add
 * the bound provider's concrete tools (every tool name that starts with the
 * provider's prefix). Pass `allToolNames` (lib/agents/tools.ts ALL_TOOL_NAMES)
 * so this module stays free of a server-only tools import.
 *
 * Shared by the interactive run route and the automation cron so both expand
 * placeholders identically.
 */
export function expandConnectorPlaceholders(
  baseAllowed: string[],
  bindings: Record<string, string>,
  allToolNames: readonly string[],
): string[] {
  const expanded = baseAllowed.filter(
    (t) => !t.startsWith(CONNECTOR_REQUIREMENT_PREFIX),
  );
  for (const category of requiredConnectorCategories(baseAllowed)) {
    const provider = bindings[category];
    if (!provider) continue; // unbound category — its tools are simply absent
    const prefix = providerToolPrefix(provider);
    expanded.push(...allToolNames.filter((t) => t.startsWith(prefix)));
  }
  return expanded;
}

/** Whether a connector belongs to a category — its primary one or an extra. */
export function connectorInCategory(
  c: Connector,
  category: ConnectorCategory,
): boolean {
  return c.category === category || (c.extraCategories?.includes(category) ?? false);
}

/** Live connectors of a category (the ones a user could pick for a run). */
export function connectorsForCategory(
  category: ConnectorCategory,
): Connector[] {
  return CONNECTORS.filter((c) => c.live && connectorInCategory(c, category));
}

/** Display name for a provider slug, from the catalog. */
export function connectorLabel(provider: string): string {
  return CONNECTORS.find((c) => c.provider === provider)?.name ?? provider;
}

/** Provider slug → the prefix its agent tools use (lib/agents/tools.ts).
 *  Most providers use "<slug>_"; the exceptions drop dashes or abbreviate. */
export function providerToolPrefix(provider: string): string {
  const exceptions: Record<string, string> = {
    "jobin-cloud": "jobin_",
    "google-sheets": "googlesheets_",
    "microsoft-excel": "excel_",
    "microsoft-outlook": "outlook_",
    "zendesk-sell": "zendesksell_",
    "zoho-crm": "zohocrm_",
    "zoho-recruit": "zohorecruit_",
  };
  return exceptions[provider] ?? `${provider}_`;
}

/** Pick the Firecrawl key for the web_search / web_scrape tools: a workspace's
 *  own connected key wins (BYO); otherwise fall back to the shared platform key
 *  (env). Returns null when neither is available, so the tools can report it.
 *  Pure so it's unit-testable; the async resolver lives in connector-tokens.ts. */
export function pickFirecrawlKey(
  workspaceToken: string | null,
  envKey: string,
): string | null {
  return workspaceToken ?? (envKey || null);
}

/** Provider slug → primary web domain, used to render brand logos via a
 *  favicon service (no logo assets to maintain across the catalog). */
export const CONNECTOR_DOMAINS: Record<string, string> = {
  ashby: "ashbyhq.com",
  bamboohr: "bamboohr.com",
  bouncer: "usebouncer.com",
  breezyhr: "breezy.hr",
  bullhorn: "bullhorn.com",
  calcom: "cal.com",
  calendly: "calendly.com",
  capsule: "capsulecrm.com",
  cats: "catsone.com",
  crelate: "crelate.com",
  discord: "discord.com",
  greenhouse: "greenhouse.io",
  jazzhr: "jazzhr.com",
  jobadder: "jobadder.com",
  "jobin-cloud": "jobin.cloud",
  lever: "lever.co",
  loxo: "loxo.co",
  manatal: "manatal.com",
  pinpoint: "pinpointhq.com",
  recruitcrm: "recruitcrm.io",
  recruitee: "recruitee.com",
  recruiterflow: "recruiterflow.com",
  recruitis: "recruitis.io",
  smartrecruiters: "smartrecruiters.com",
  teamtailor: "teamtailor.com",
  telegram: "telegram.org",
  vincere: "vincere.io",
  workable: "workable.com",
  "zoho-recruit": "zoho.com",
  adzuna: "adzuna.com",
  affinity: "affinity.co",
  aircall: "aircall.io",
  messagebird: "bird.com",
  attio: "attio.com",
  hubspot: "hubspot.com",
  monday: "monday.com",
  millionverifier: "millionverifier.com",
  neverbounce: "neverbounce.com",
  notion: "notion.so",
  nymeria: "nymeria.io",
  pipedrive: "pipedrive.com",
  "zendesk-sell": "zendesk.com",
  "zoho-crm": "zoho.com",
  airtable: "airtable.com",
  "google-sheets": "sheets.google.com",
  "microsoft-excel": "microsoft.com",
  gmail: "mail.google.com",
  "microsoft-outlook": "outlook.com",
  slack: "slack.com",
  apollo: "apollo.io",
  avoma: "avoma.com",
  brightdata: "brightdata.com",
  close: "close.com",
  contactout: "contactout.com",
  copper: "copper.com",
  coresignal: "coresignal.com",
  dropcontact: "dropcontact.com",
  duckduckgo: "duckduckgo.com",
  emailable: "emailable.com",
  fathom: "fathom.video",
  findymail: "findymail.com",
  firecrawl: "firecrawl.dev",
  fireflies: "fireflies.ai",
  folk: "folk.app",
  fullenrich: "fullenrich.com",
  github: "github.com",
  gong: "gong.io",
  grain: "grain.com",
  hunter: "hunter.io",
  insightly: "insightly.com",
  instantly: "instantly.ai",
  klenty: "klenty.com",
  leadmagic: "leadmagic.io",
  lemlist: "lemlist.com",
  lusha: "lusha.com",
  mailshake: "mailshake.com",
  peopledatalabs: "peopledatalabs.com",
  prospeo: "prospeo.io",
  replyio: "reply.io",
  rocketreach: "rocketreach.co",
  salesflare: "salesflare.com",
  serpapi: "serpapi.com",
  signalhire: "signalhire.com",
  skrapp: "skrapp.io",
  smartlead: "smartlead.ai",
  snov: "snov.io",
  stackexchange: "stackoverflow.com",
  surfe: "surfe.com",
  tldv: "tldv.io",
  tomba: "tomba.io",
  trestle: "trestleiq.com",
  twilio: "twilio.com",
  wiza: "wiza.co",
  woodpecker: "woodpecker.co",
  zerobounce: "zerobounce.net",
  zoom: "zoom.us",
};

/** Brand-logo URL for a domain, via Google's favicon service (no logo assets
 *  to host). Returns undefined when there's no domain to render. */
export function connectorFaviconUrl(
  domain: string | undefined,
  size = 64,
): string | undefined {
  if (!domain) return undefined;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}
