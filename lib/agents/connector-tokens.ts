import "server-only";
import { getConnection } from "../queries";
import { getValidAccessToken } from "../integrations";

// One valid access token per live connector, or null when the workspace hasn't
// connected it. Shared by the interactive agent run route and the headless
// runner (cron / Slack) so both resolve tokens identically — adding a connector
// is a one-line change to SPECS plus the matching ToolContext field.

export interface ConnectorTokens {
  airtableToken: string | null;
  apolloToken: string | null;
  ashbyToken: string | null;
  attioToken: string | null;
  avomaToken: string | null;
  bamboohrToken: string | null;
  breezyhrToken: string | null;
  brightdataToken: string | null;
  bullhornToken: string | null;
  catsToken: string | null;
  closeToken: string | null;
  contactoutToken: string | null;
  coresignalToken: string | null;
  crelateToken: string | null;
  dropcontactToken: string | null;
  fathomToken: string | null;
  findymailToken: string | null;
  firefliesToken: string | null;
  folkToken: string | null;
  fullenrichToken: string | null;
  githubToken: string | null;
  gmailToken: string | null;
  gongToken: string | null;
  googleSheetsToken: string | null;
  greenhouseToken: string | null;
  hubspotToken: string | null;
  hunterToken: string | null;
  instantlyToken: string | null;
  jazzhrToken: string | null;
  jobadderToken: string | null;
  lemlistToken: string | null;
  leverToken: string | null;
  loxoToken: string | null;
  lushaToken: string | null;
  manatalToken: string | null;
  microsoftExcelToken: string | null;
  microsoftOutlookToken: string | null;
  mondayToken: string | null;
  notionToken: string | null;
  peopledatalabsToken: string | null;
  pinpointToken: string | null;
  pipedriveToken: string | null;
  recruiteeToken: string | null;
  recruiterflowToken: string | null;
  recruitisToken: string | null;
  replyioToken: string | null;
  rocketreachToken: string | null;
  signalhireToken: string | null;
  slackToken: string | null;
  smartleadToken: string | null;
  smartrecruitersToken: string | null;
  snovToken: string | null;
  teamtailorToken: string | null;
  tldvToken: string | null;
  vincereToken: string | null;
  wizaToken: string | null;
  woodpeckerToken: string | null;
  workableToken: string | null;
  zohoCrmToken: string | null;
  zohoRecruitToken: string | null;
}

interface TokenSpec {
  field: keyof ConnectorTokens;
  /** Tool-name prefix that signals the agent uses this connector. */
  prefix: string;
  /** workspace_connections.provider slug. */
  provider: string;
}

const SPECS: TokenSpec[] = [
  { field: "airtableToken", prefix: "airtable_", provider: "airtable" },
  { field: "apolloToken", prefix: "apollo_", provider: "apollo" },
  { field: "ashbyToken", prefix: "ashby_", provider: "ashby" },
  { field: "attioToken", prefix: "attio_", provider: "attio" },
  { field: "avomaToken", prefix: "avoma_", provider: "avoma" },
  { field: "bamboohrToken", prefix: "bamboohr_", provider: "bamboohr" },
  { field: "breezyhrToken", prefix: "breezyhr_", provider: "breezyhr" },
  { field: "brightdataToken", prefix: "brightdata_", provider: "brightdata" },
  { field: "bullhornToken", prefix: "bullhorn_", provider: "bullhorn" },
  { field: "catsToken", prefix: "cats_", provider: "cats" },
  { field: "closeToken", prefix: "close_", provider: "close" },
  { field: "contactoutToken", prefix: "contactout_", provider: "contactout" },
  { field: "coresignalToken", prefix: "coresignal_", provider: "coresignal" },
  { field: "crelateToken", prefix: "crelate_", provider: "crelate" },
  { field: "dropcontactToken", prefix: "dropcontact_", provider: "dropcontact" },
  { field: "fathomToken", prefix: "fathom_", provider: "fathom" },
  { field: "findymailToken", prefix: "findymail_", provider: "findymail" },
  { field: "firefliesToken", prefix: "fireflies_", provider: "fireflies" },
  { field: "folkToken", prefix: "folk_", provider: "folk" },
  { field: "fullenrichToken", prefix: "fullenrich_", provider: "fullenrich" },
  { field: "githubToken", prefix: "github_", provider: "github" },
  { field: "gmailToken", prefix: "gmail_", provider: "gmail" },
  { field: "gongToken", prefix: "gong_", provider: "gong" },
  { field: "googleSheetsToken", prefix: "googlesheets_", provider: "google-sheets" },
  { field: "greenhouseToken", prefix: "greenhouse_", provider: "greenhouse" },
  { field: "hubspotToken", prefix: "hubspot_", provider: "hubspot" },
  { field: "hunterToken", prefix: "hunter_", provider: "hunter" },
  { field: "instantlyToken", prefix: "instantly_", provider: "instantly" },
  { field: "jazzhrToken", prefix: "jazzhr_", provider: "jazzhr" },
  { field: "jobadderToken", prefix: "jobadder_", provider: "jobadder" },
  { field: "lemlistToken", prefix: "lemlist_", provider: "lemlist" },
  { field: "leverToken", prefix: "lever_", provider: "lever" },
  { field: "loxoToken", prefix: "loxo_", provider: "loxo" },
  { field: "lushaToken", prefix: "lusha_", provider: "lusha" },
  { field: "manatalToken", prefix: "manatal_", provider: "manatal" },
  { field: "microsoftExcelToken", prefix: "excel_", provider: "microsoft-excel" },
  { field: "microsoftOutlookToken", prefix: "outlook_", provider: "microsoft-outlook" },
  { field: "mondayToken", prefix: "monday_", provider: "monday" },
  { field: "notionToken", prefix: "notion_", provider: "notion" },
  { field: "peopledatalabsToken", prefix: "peopledatalabs_", provider: "peopledatalabs" },
  { field: "pinpointToken", prefix: "pinpoint_", provider: "pinpoint" },
  { field: "pipedriveToken", prefix: "pipedrive_", provider: "pipedrive" },
  { field: "recruiteeToken", prefix: "recruitee_", provider: "recruitee" },
  { field: "recruiterflowToken", prefix: "recruiterflow_", provider: "recruiterflow" },
  { field: "recruitisToken", prefix: "recruitis_", provider: "recruitis" },
  { field: "replyioToken", prefix: "replyio_", provider: "replyio" },
  { field: "rocketreachToken", prefix: "rocketreach_", provider: "rocketreach" },
  { field: "signalhireToken", prefix: "signalhire_", provider: "signalhire" },
  { field: "slackToken", prefix: "slack_", provider: "slack" },
  { field: "smartleadToken", prefix: "smartlead_", provider: "smartlead" },
  { field: "smartrecruitersToken", prefix: "smartrecruiters_", provider: "smartrecruiters" },
  { field: "snovToken", prefix: "snov_", provider: "snov" },
  { field: "teamtailorToken", prefix: "teamtailor_", provider: "teamtailor" },
  { field: "tldvToken", prefix: "tldv_", provider: "tldv" },
  { field: "vincereToken", prefix: "vincere_", provider: "vincere" },
  { field: "wizaToken", prefix: "wiza_", provider: "wiza" },
  { field: "woodpeckerToken", prefix: "woodpecker_", provider: "woodpecker" },
  { field: "workableToken", prefix: "workable_", provider: "workable" },
  { field: "zohoCrmToken", prefix: "zohocrm_", provider: "zoho-crm" },
  { field: "zohoRecruitToken", prefix: "zohorecruit_", provider: "zoho-recruit" },
];

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
