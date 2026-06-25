import "server-only";
import { getConnection } from "../queries";
import { getValidAccessToken } from "../integrations";
import { pickFirecrawlKey } from "../connectors";
import { env } from "../env";

// One valid access token per live connector, or null when the workspace hasn't
// connected it. Shared by the interactive agent run route and the headless
// runner (cron / Slack) so both resolve tokens identically — adding a connector
// is a one-line change to SPECS plus the matching ToolContext field.

export interface ConnectorTokens {
  adzunaToken: string | null;
  affinityToken: string | null;
  aircallToken: string | null;
  airtableToken: string | null;
  apolloToken: string | null;
  ashbyToken: string | null;
  attioToken: string | null;
  avomaToken: string | null;
  bamboohrToken: string | null;
  bouncerToken: string | null;
  breezyhrToken: string | null;
  brightdataToken: string | null;
  bullhornToken: string | null;
  calcomToken: string | null;
  calendlyToken: string | null;
  capsuleToken: string | null;
  catsToken: string | null;
  closeToken: string | null;
  contactoutToken: string | null;
  copperToken: string | null;
  coresignalToken: string | null;
  crelateToken: string | null;
  discordToken: string | null;
  dropcontactToken: string | null;
  emailableToken: string | null;
  fathomToken: string | null;
  findymailToken: string | null;
  firefliesToken: string | null;
  folkToken: string | null;
  fullenrichToken: string | null;
  githubToken: string | null;
  gmailToken: string | null;
  gongToken: string | null;
  googleSheetsToken: string | null;
  grainToken: string | null;
  greenhouseToken: string | null;
  hubspotToken: string | null;
  hunterToken: string | null;
  insightlyToken: string | null;
  instantlyToken: string | null;
  jazzhrToken: string | null;
  jobadderToken: string | null;
  klentyToken: string | null;
  leadmagicToken: string | null;
  lemlistToken: string | null;
  leverToken: string | null;
  loxoToken: string | null;
  lushaToken: string | null;
  mailshakeToken: string | null;
  manatalToken: string | null;
  messagebirdToken: string | null;
  microsoftExcelToken: string | null;
  microsoftOutlookToken: string | null;
  millionverifierToken: string | null;
  mondayToken: string | null;
  neverbounceToken: string | null;
  notionToken: string | null;
  nymeriaToken: string | null;
  peopledatalabsToken: string | null;
  pinpointToken: string | null;
  pipedriveToken: string | null;
  prospeoToken: string | null;
  recruitcrmToken: string | null;
  recruiteeToken: string | null;
  recruiterflowToken: string | null;
  recruitisToken: string | null;
  replyioToken: string | null;
  rocketreachToken: string | null;
  salesflareToken: string | null;
  serpapiToken: string | null;
  signalhireToken: string | null;
  skrappToken: string | null;
  slackToken: string | null;
  smartleadToken: string | null;
  smartrecruitersToken: string | null;
  snovToken: string | null;
  stackexchangeToken: string | null;
  surfeToken: string | null;
  teamtailorToken: string | null;
  telegramToken: string | null;
  tldvToken: string | null;
  tombaToken: string | null;
  trestleToken: string | null;
  twilioToken: string | null;
  vincereToken: string | null;
  wizaToken: string | null;
  woodpeckerToken: string | null;
  workableToken: string | null;
  zendeskSellToken: string | null;
  zerobounceToken: string | null;
  zohoCrmToken: string | null;
  zohoRecruitToken: string | null;
  zoomToken: string | null;
}

interface TokenSpec {
  field: keyof ConnectorTokens;
  /** Tool-name prefix that signals the agent uses this connector. */
  prefix: string;
  /** workspace_connections.provider slug. */
  provider: string;
}

const SPECS: TokenSpec[] = [
  { field: "adzunaToken", prefix: "adzuna_", provider: "adzuna" },
  { field: "affinityToken", prefix: "affinity_", provider: "affinity" },
  { field: "aircallToken", prefix: "aircall_", provider: "aircall" },
  { field: "airtableToken", prefix: "airtable_", provider: "airtable" },
  { field: "apolloToken", prefix: "apollo_", provider: "apollo" },
  { field: "ashbyToken", prefix: "ashby_", provider: "ashby" },
  { field: "attioToken", prefix: "attio_", provider: "attio" },
  { field: "avomaToken", prefix: "avoma_", provider: "avoma" },
  { field: "bamboohrToken", prefix: "bamboohr_", provider: "bamboohr" },
  { field: "bouncerToken", prefix: "bouncer_", provider: "bouncer" },
  { field: "breezyhrToken", prefix: "breezyhr_", provider: "breezyhr" },
  { field: "brightdataToken", prefix: "brightdata_", provider: "brightdata" },
  { field: "bullhornToken", prefix: "bullhorn_", provider: "bullhorn" },
  { field: "calcomToken", prefix: "calcom_", provider: "calcom" },
  { field: "calendlyToken", prefix: "calendly_", provider: "calendly" },
  { field: "capsuleToken", prefix: "capsule_", provider: "capsule" },
  { field: "catsToken", prefix: "cats_", provider: "cats" },
  { field: "closeToken", prefix: "close_", provider: "close" },
  { field: "contactoutToken", prefix: "contactout_", provider: "contactout" },
  { field: "copperToken", prefix: "copper_", provider: "copper" },
  { field: "coresignalToken", prefix: "coresignal_", provider: "coresignal" },
  { field: "crelateToken", prefix: "crelate_", provider: "crelate" },
  { field: "discordToken", prefix: "discord_", provider: "discord" },
  { field: "dropcontactToken", prefix: "dropcontact_", provider: "dropcontact" },
  { field: "emailableToken", prefix: "emailable_", provider: "emailable" },
  { field: "fathomToken", prefix: "fathom_", provider: "fathom" },
  { field: "findymailToken", prefix: "findymail_", provider: "findymail" },
  { field: "firefliesToken", prefix: "fireflies_", provider: "fireflies" },
  { field: "folkToken", prefix: "folk_", provider: "folk" },
  { field: "fullenrichToken", prefix: "fullenrich_", provider: "fullenrich" },
  { field: "githubToken", prefix: "github_", provider: "github" },
  { field: "gmailToken", prefix: "gmail_", provider: "gmail" },
  { field: "gongToken", prefix: "gong_", provider: "gong" },
  { field: "googleSheetsToken", prefix: "googlesheets_", provider: "google-sheets" },
  { field: "grainToken", prefix: "grain_", provider: "grain" },
  { field: "greenhouseToken", prefix: "greenhouse_", provider: "greenhouse" },
  { field: "hubspotToken", prefix: "hubspot_", provider: "hubspot" },
  { field: "hunterToken", prefix: "hunter_", provider: "hunter" },
  { field: "insightlyToken", prefix: "insightly_", provider: "insightly" },
  { field: "instantlyToken", prefix: "instantly_", provider: "instantly" },
  { field: "jazzhrToken", prefix: "jazzhr_", provider: "jazzhr" },
  { field: "jobadderToken", prefix: "jobadder_", provider: "jobadder" },
  { field: "klentyToken", prefix: "klenty_", provider: "klenty" },
  { field: "leadmagicToken", prefix: "leadmagic_", provider: "leadmagic" },
  { field: "lemlistToken", prefix: "lemlist_", provider: "lemlist" },
  { field: "leverToken", prefix: "lever_", provider: "lever" },
  { field: "loxoToken", prefix: "loxo_", provider: "loxo" },
  { field: "lushaToken", prefix: "lusha_", provider: "lusha" },
  { field: "mailshakeToken", prefix: "mailshake_", provider: "mailshake" },
  { field: "manatalToken", prefix: "manatal_", provider: "manatal" },
  { field: "messagebirdToken", prefix: "messagebird_", provider: "messagebird" },
  { field: "microsoftExcelToken", prefix: "excel_", provider: "microsoft-excel" },
  { field: "microsoftOutlookToken", prefix: "outlook_", provider: "microsoft-outlook" },
  { field: "millionverifierToken", prefix: "millionverifier_", provider: "millionverifier" },
  { field: "mondayToken", prefix: "monday_", provider: "monday" },
  { field: "neverbounceToken", prefix: "neverbounce_", provider: "neverbounce" },
  { field: "notionToken", prefix: "notion_", provider: "notion" },
  { field: "nymeriaToken", prefix: "nymeria_", provider: "nymeria" },
  { field: "peopledatalabsToken", prefix: "peopledatalabs_", provider: "peopledatalabs" },
  { field: "pinpointToken", prefix: "pinpoint_", provider: "pinpoint" },
  { field: "pipedriveToken", prefix: "pipedrive_", provider: "pipedrive" },
  { field: "prospeoToken", prefix: "prospeo_", provider: "prospeo" },
  { field: "recruitcrmToken", prefix: "recruitcrm_", provider: "recruitcrm" },
  { field: "recruiteeToken", prefix: "recruitee_", provider: "recruitee" },
  { field: "recruiterflowToken", prefix: "recruiterflow_", provider: "recruiterflow" },
  { field: "recruitisToken", prefix: "recruitis_", provider: "recruitis" },
  { field: "replyioToken", prefix: "replyio_", provider: "replyio" },
  { field: "rocketreachToken", prefix: "rocketreach_", provider: "rocketreach" },
  { field: "salesflareToken", prefix: "salesflare_", provider: "salesflare" },
  { field: "serpapiToken", prefix: "serpapi_", provider: "serpapi" },
  { field: "signalhireToken", prefix: "signalhire_", provider: "signalhire" },
  { field: "skrappToken", prefix: "skrapp_", provider: "skrapp" },
  { field: "slackToken", prefix: "slack_", provider: "slack" },
  { field: "smartleadToken", prefix: "smartlead_", provider: "smartlead" },
  { field: "smartrecruitersToken", prefix: "smartrecruiters_", provider: "smartrecruiters" },
  { field: "snovToken", prefix: "snov_", provider: "snov" },
  { field: "stackexchangeToken", prefix: "stackexchange_", provider: "stackexchange" },
  { field: "surfeToken", prefix: "surfe_", provider: "surfe" },
  { field: "teamtailorToken", prefix: "teamtailor_", provider: "teamtailor" },
  { field: "telegramToken", prefix: "telegram_", provider: "telegram" },
  { field: "tldvToken", prefix: "tldv_", provider: "tldv" },
  { field: "tombaToken", prefix: "tomba_", provider: "tomba" },
  { field: "trestleToken", prefix: "trestle_", provider: "trestle" },
  { field: "twilioToken", prefix: "twilio_", provider: "twilio" },
  { field: "vincereToken", prefix: "vincere_", provider: "vincere" },
  { field: "wizaToken", prefix: "wiza_", provider: "wiza" },
  { field: "woodpeckerToken", prefix: "woodpecker_", provider: "woodpecker" },
  { field: "workableToken", prefix: "workable_", provider: "workable" },
  { field: "zendeskSellToken", prefix: "zendesksell_", provider: "zendesk-sell" },
  { field: "zerobounceToken", prefix: "zerobounce_", provider: "zerobounce" },
  { field: "zohoCrmToken", prefix: "zohocrm_", provider: "zoho-crm" },
  { field: "zohoRecruitToken", prefix: "zohorecruit_", provider: "zoho-recruit" },
  { field: "zoomToken", prefix: "zoom_", provider: "zoom" },
];

/**
 * Resolve the Firecrawl key for the web_search / web_scrape tools (ToolContext
 * .firecrawlKey). A workspace's own connected Firecrawl key wins (BYO); a broken
 * connection or no connection falls back to the shared platform key (env). The
 * web_* tools aren't provider-prefixed, so this is resolved on its own rather
 * than through resolveConnectorTokens.
 */
export async function resolveFirecrawlKey(
  workspaceId: string,
): Promise<string | null> {
  let workspaceToken: string | null = null;
  const connection = await getConnection(workspaceId, "firecrawl");
  if (connection) {
    try {
      workspaceToken = await getValidAccessToken(connection);
    } catch {
      // Broken/unreadable connection — fall back to the platform key.
      workspaceToken = null;
    }
  }
  return pickFirecrawlKey(workspaceToken, env.firecrawlApiKey);
}

/** All-null tokens — the base for a headless run that uses no connectors. */
export function blankConnectorTokens(): ConnectorTokens {
  const out = {} as ConnectorTokens;
  for (const s of SPECS) out[s.field] = null;
  return out;
}

/**
 * Resolve a valid token for each connector the `allowed` tool list references,
 * up front (refreshing OAuth tokens if needed). A configured-but-broken
 * connection throws (so the caller can fail the run with a reconnect message); a
 * not-yet-connected one stays null so its tools report "not connected" rather
 * than failing the whole run.
 */
export async function resolveConnectorTokens(
  workspaceId: string,
  allowed: string[],
): Promise<ConnectorTokens> {
  const values = await Promise.all(
    SPECS.map(async (s) => {
      if (!allowed.some((t) => t.startsWith(s.prefix))) return null;
      const connection = await getConnection(workspaceId, s.provider);
      if (!connection) return null;
      return getValidAccessToken(connection);
    }),
  );
  const out = {} as ConnectorTokens;
  SPECS.forEach((s, i) => {
    out[s.field] = values[i];
  });
  return out;
}
