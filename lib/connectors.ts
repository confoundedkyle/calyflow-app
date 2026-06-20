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
  { name: "Lever", category: "ats", blurb: "Sync pipelines from the CRM-style ATS teams love.", provider: "lever", live: true, auth: "apikey" },
  { name: "Loxo", category: "ats", blurb: "Pull candidates from the AI recruiting platform for agencies.", provider: "loxo", live: true, auth: "apikey", apiKeyPlaceholder: "agency-slug:api-key", apiKeyHint: "The slug is the subdomain in your Loxo URL ({slug}.app.loxo.co); keys live in Settings → API Keys (Open API access is a paid Loxo feature)." },
  { name: "Manatal", category: "ats", blurb: "Import candidates from the affordable AI-recommendation ATS.", provider: "manatal", live: true, auth: "apikey" },
  { name: "Pinpoint", category: "ats", blurb: "Sync roles from the in-house talent acquisition platform.", provider: "pinpoint", live: true, auth: "apikey", apiKeyPlaceholder: "subdomain:api-key", apiKeyHint: "The subdomain is your Pinpoint URL ({subdomain}.pinpointhq.com); keys are created under Company settings → API keys." },
  { name: "Recruitee", category: "ats", blurb: "Pull collaborative hiring pipelines straight into your projects.", provider: "recruitee", live: true, auth: "apikey", apiKeyPlaceholder: "company-id:token", apiKeyHint: "Both are shown in Recruitee under Settings → Apps and plugins → Personal API tokens (the company ID is the number next to your token)." },
  { name: "Recruiterflow", category: "ats", blurb: "Sync the ATS + CRM built for recruiting firms.", provider: "recruiterflow", live: true, auth: "apikey" },
  { name: "Recruitis", category: "ats", blurb: "Pull jobs and candidate pipelines from the recruitment ATS.", provider: "recruitis", live: true, auth: "apikey", apiKeyHint: "Generate a token in Recruitis under Settings → API (it needs the read scopes, e.g. api.position.read and api.candidates.read)." },
  { name: "SmartRecruiters", category: "ats", blurb: "Sync jobs and candidates from the enterprise TA suite.", provider: "smartrecruiters", live: true, auth: "apikey" },
  { name: "Teamtailor", category: "ats", blurb: "Import candidates from the employer-branding-first ATS.", provider: "teamtailor", live: true, auth: "apikey" },
  { name: "Vincere", category: "ats", extraCategories: ["crm"], blurb: "Search candidates, contacts, companies, applications, and talent pools from the recruitment agency ATS + CRM.", provider: "vincere", live: true, auth: "oauth", byoOAuth: true, oauthAppHint: "In Vincere go to Settings → API → API Authentication & Throttling, register an app with the redirect URI shown above, then paste its Client ID here (add a Client Secret only if Vincere issued your app a confidential one)." },
  { name: "Workable", category: "ats", blurb: "Pull jobs and candidates from the all-in-one hiring platform.", provider: "workable", live: true, auth: "apikey" },
  { name: "Zoho Recruit", category: "ats", blurb: "Import candidates from Zoho's staffing-ready ATS.", provider: "zoho-recruit", live: true, auth: "oauth" },

  // CRM
  { name: "Attio", category: "crm", blurb: "Query people, companies, and deals from the modern CRM.", provider: "attio", live: true, auth: "apikey" },
  { name: "Close", category: "crm", blurb: "Read client leads and BD opportunities from the sales-focused CRM.", provider: "close", live: true, auth: "apikey", apiKeyHint: "Create an API key in Close under Settings → Developer → API Keys." },
  { name: "folk", category: "crm", blurb: "Read the people and client companies from the relationship-first CRM.", provider: "folk", live: true, auth: "apikey", apiKeyHint: "Create an API key in folk under Settings → Workspace → API." },
  { name: "HubSpot", category: "crm", blurb: "Sync client companies, deals, and contacts effortlessly.", provider: "hubspot", live: true, auth: "apikey" },
  { name: "monday.com", category: "crm", blurb: "Read the candidate and client boards your agency already runs.", provider: "monday", live: true, auth: "apikey", apiKeyHint: "Copy your personal API token from your monday.com profile picture → Developers → API token." },
  { name: "Notion", category: "crm", blurb: "Read the databases and pages your team already runs recruiting on.", provider: "notion", live: true, auth: "oauth" },
  { name: "Pipedrive", category: "crm", blurb: "Pull your BD pipeline and client deals into Calyflow.", provider: "pipedrive", live: true, auth: "apikey" },
  { name: "Zoho CRM", category: "crm", blurb: "Sync clients and deals from Zoho's sales suite.", provider: "zoho-crm", live: true, auth: "oauth" },

  // Data (spreadsheets & flexible databases)
  { name: "Airtable", category: "data", blurb: "Sync the flexible candidate and client bases you already run.", provider: "airtable", live: true, auth: "oauth" },
  { name: "Google Sheets", category: "data", blurb: "Read candidate and client trackers straight from your Google Sheets.", provider: "google-sheets", live: true, auth: "oauth" },
  { name: "Microsoft Excel", category: "data", blurb: "Pull pipelines and lists from Excel workbooks in OneDrive and SharePoint.", provider: "microsoft-excel", live: true, auth: "oauth" },

  // --- Email (sending on the user's behalf, e.g. agent outreach) ---
  { name: "Gmail", category: "email", blurb: "Send candidate outreach from your own Gmail address.", provider: "gmail", live: true, auth: "oauth" },
  { name: "Microsoft Outlook", category: "email", blurb: "Send candidate outreach from your Outlook / Microsoft 365 mailbox.", provider: "microsoft-outlook", live: true, auth: "oauth" },

  // --- Comms (team messaging — where recruiting agents reach hiring managers) ---
  { name: "Slack", category: "comms", blurb: "Run recruiting agents and receive project reports in your team's Slack — a channel per project.", provider: "slack", live: true, auth: "oauth", oauthAppHint: "Connect in one click with the Calyflow Slack app. Self-hosting? Create your own app at api.slack.com, add the redirect URI shown above, and set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET." },

  // Tools (sourcing & outreach)
  { name: "Apollo", category: "tool", blurb: "Source contact data from the 270M-profile B2B database.", provider: "apollo", live: true, auth: "apikey" },
  { name: "Avoma", category: "tool", blurb: "Read transcripts and AI notes from your recorded intake and screening calls.", provider: "avoma", live: true, auth: "apikey", apiKeyHint: "Create a scoped API key in Avoma under Settings → API." },
  { name: "Bright Data", category: "tool", blurb: "Enrich profiles with large-scale public web data.", provider: "brightdata", live: true, auth: "apikey" },
  { name: "ContactOut", category: "tool", blurb: "Find personal emails and phones behind LinkedIn profiles.", provider: "contactout", live: true, auth: "apikey" },
  { name: "Coresignal", category: "tool", blurb: "Enrich candidates with fresh public employment data.", provider: "coresignal", live: true, auth: "apikey" },
  { name: "Dropcontact", category: "tool", blurb: "Find and verify GDPR-compliant emails for European candidates and clients.", provider: "dropcontact", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Dropcontact under Settings → Your API key (API access requires a paid plan)." },
  { name: "Fathom", category: "tool", blurb: "Read AI summaries and transcripts of your recorded calls.", provider: "fathom", live: true, auth: "apikey" },
  { name: "Findymail", category: "tool", blurb: "Find and verify B2B emails and mobile numbers for candidates and clients.", provider: "findymail", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Findymail at app.findymail.com → API." },
  { name: "Fireflies.ai", category: "tool", blurb: "Search interview and client-call transcripts and summaries.", provider: "fireflies", live: true, auth: "apikey" },
  { name: "FullEnrich", category: "tool", blurb: "Find verified emails and mobile numbers through a 15+ vendor waterfall.", provider: "fullenrich", live: true, auth: "apikey", apiKeyHint: "Copy your API key from FullEnrich at app.fullenrich.com → API." },
  { name: "GitHub", category: "tool", blurb: "Source engineers from open-source repos — contributors, forkers, and commit-email contacts.", provider: "github", live: true, auth: "apikey", apiKeyHint: "Create a Personal Access Token at github.com → Settings → Developer settings → Personal access tokens (a classic token with the public_repo scope, or a fine-grained read-only token, is enough)." },
  { name: "Gong", category: "tool", blurb: "Read briefs and transcripts from your recorded sales and intake calls.", provider: "gong", live: true, auth: "apikey", apiKeyPlaceholder: "access-key:secret", apiKeyHint: "A Gong admin creates the access-key pair under company settings → Ecosystem → API; paste both parts separated by a colon." },
  { name: "Hunter.io", category: "tool", blurb: "Find and verify work email addresses instantly.", provider: "hunter", live: true, auth: "apikey" },
  { name: "Instantly.ai", category: "tool", blurb: "Scale cold email outreach with automated warm-up.", provider: "instantly", live: true, auth: "apikey" },
  { name: "Lemlist", category: "tool", blurb: "Personalised cold outreach sequences that get replies.", provider: "lemlist", live: true, auth: "apikey" },
  { name: "Lusha", category: "tool", blurb: "B2B contact data to reach candidates and clients.", provider: "lusha", live: true, auth: "apikey" },
  { name: "People Data Labs", category: "tool", blurb: "Enrich and search billions of person profiles at scale.", provider: "peopledatalabs", live: true, auth: "apikey" },
  { name: "Reply.io", category: "tool", blurb: "Read multichannel outreach sequences and contacts to coordinate candidate and client follow-up.", provider: "replyio", live: true, auth: "apikey", apiKeyHint: "Copy your API key from Reply.io under Settings → API key." },
  { name: "RocketReach", category: "tool", blurb: "Find emails and phones across 700M+ professional profiles.", provider: "rocketreach", live: true, auth: "apikey" },
  { name: "SignalHire", category: "tool", blurb: "Reveal candidate emails and phones with the recruiter-built contact finder.", provider: "signalhire", live: true, auth: "apikey", apiKeyHint: "Create the key in SignalHire under Integrations & API; the same credit pool is shared with the web app and extension." },
  { name: "Smartlead", category: "tool", blurb: "Track cold-email campaigns, leads, and reply analytics.", provider: "smartlead", live: true, auth: "apikey" },
  { name: "Snov.io", category: "tool", blurb: "Find and verify work emails for outreach-ready lists.", provider: "snov", live: true, auth: "apikey", apiKeyPlaceholder: "client-id:client-secret", apiKeyHint: "Both are shown in Snov.io under your account settings → API." },
  { name: "tl;dv", category: "tool", blurb: "Read AI notes and transcripts from your recorded meetings.", provider: "tldv", live: true, auth: "apikey", apiKeyHint: "Create the key under personal settings → API Keys; API access requires the tl;dv Business plan." },
  { name: "Wiza", category: "tool", blurb: "Reveal verified emails and mobile numbers from LinkedIn profiles.", provider: "wiza", live: true, auth: "apikey", apiKeyHint: "Create an API key in Wiza under Settings → API." },
  { name: "Woodpecker", category: "tool", blurb: "Track cold-email campaigns and prospect replies, EU-style.", provider: "woodpecker", live: true, auth: "apikey", apiKeyHint: "Create the key in Woodpecker under Add-ons → API & Integrations → API keys." },
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
    "google-sheets": "googlesheets_",
    "microsoft-excel": "excel_",
    "microsoft-outlook": "outlook_",
    "zoho-crm": "zohocrm_",
    "zoho-recruit": "zohorecruit_",
  };
  return exceptions[provider] ?? `${provider}_`;
}

/** Provider slug → primary web domain, used to render brand logos via a
 *  favicon service (no logo assets to maintain across the catalog). */
export const CONNECTOR_DOMAINS: Record<string, string> = {
  ashby: "ashbyhq.com",
  bamboohr: "bamboohr.com",
  breezyhr: "breezy.hr",
  bullhorn: "bullhorn.com",
  cats: "catsone.com",
  crelate: "crelate.com",
  greenhouse: "greenhouse.io",
  jazzhr: "jazzhr.com",
  jobadder: "jobadder.com",
  lever: "lever.co",
  loxo: "loxo.co",
  manatal: "manatal.com",
  pinpoint: "pinpointhq.com",
  recruitee: "recruitee.com",
  recruiterflow: "recruiterflow.com",
  recruitis: "recruitis.io",
  smartrecruiters: "smartrecruiters.com",
  teamtailor: "teamtailor.com",
  vincere: "vincere.io",
  workable: "workable.com",
  "zoho-recruit": "zoho.com",
  attio: "attio.com",
  hubspot: "hubspot.com",
  monday: "monday.com",
  notion: "notion.so",
  pipedrive: "pipedrive.com",
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
  coresignal: "coresignal.com",
  dropcontact: "dropcontact.com",
  fathom: "fathom.video",
  findymail: "findymail.com",
  fireflies: "fireflies.ai",
  folk: "folk.app",
  fullenrich: "fullenrich.com",
  github: "github.com",
  gong: "gong.io",
  hunter: "hunter.io",
  instantly: "instantly.ai",
  lemlist: "lemlist.com",
  lusha: "lusha.com",
  peopledatalabs: "peopledatalabs.com",
  replyio: "reply.io",
  rocketreach: "rocketreach.co",
  signalhire: "signalhire.com",
  smartlead: "smartlead.ai",
  snov: "snov.io",
  tldv: "tldv.io",
  wiza: "wiza.co",
  woodpecker: "woodpecker.co",
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
