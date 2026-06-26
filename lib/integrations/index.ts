import "server-only";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import type { Connection } from "../types";
import { adzunaAdapter } from "./adzuna";
import { affinityAdapter } from "./affinity";
import { aircallAdapter } from "./aircall";
import { airtableAdapter } from "./airtable";
import { apolloAdapter } from "./apollo";
import { ashbyAdapter } from "./ashby";
import { attioAdapter } from "./attio";
import { avomaAdapter } from "./avoma";
import { bamboohrAdapter } from "./bamboohr";
import { bouncerAdapter } from "./bouncer";
import { breezyhrAdapter } from "./breezyhr";
import { brightdataAdapter } from "./brightdata";
import { bullhornAdapter } from "./bullhorn";
import { calcomAdapter } from "./calcom";
import { calendlyAdapter } from "./calendly";
import { capsuleAdapter } from "./capsule";
import { catsAdapter } from "./cats";
import { closeAdapter } from "./close";
import { contactoutAdapter } from "./contactout";
import { copperAdapter } from "./copper";
import { coresignalAdapter } from "./coresignal";
import { crelateAdapter } from "./crelate";
import { discordAdapter } from "./discord";
import { dropcontactAdapter } from "./dropcontact";
import { emailableAdapter } from "./emailable";
import { fathomAdapter } from "./fathom";
import { findymailAdapter } from "./findymail";
import { firecrawlAdapter } from "./firecrawl";
import { firefliesAdapter } from "./fireflies";
import { folkAdapter } from "./folk";
import { fullenrichAdapter } from "./fullenrich";
import { githubAdapter } from "./github";
import { gmailAdapter } from "./gmail";
import { gongAdapter } from "./gong";
import { googleSheetsAdapter } from "./google-sheets";
import { grainAdapter } from "./grain";
import { greenhouseAdapter } from "./greenhouse";
import { hubspotAdapter } from "./hubspot";
import { hunterAdapter } from "./hunter";
import { insightlyAdapter } from "./insightly";
import { instantlyAdapter } from "./instantly";
import { jazzhrAdapter } from "./jazzhr";
import { jobadderAdapter } from "./jobadder";
import { jobinAdapter } from "./jobin";
import { klentyAdapter } from "./klenty";
import { leadmagicAdapter } from "./leadmagic";
import { lemlistAdapter } from "./lemlist";
import { leverAdapter } from "./lever";
import { loxoAdapter } from "./loxo";
import { lushaAdapter } from "./lusha";
import { mailshakeAdapter } from "./mailshake";
import { manatalAdapter } from "./manatal";
import { messagebirdAdapter } from "./messagebird";
import { microsoftExcelAdapter } from "./microsoft-excel";
import { microsoftOutlookAdapter } from "./microsoft-outlook";
import { millionverifierAdapter } from "./millionverifier";
import { mondayAdapter } from "./monday";
import { neverbounceAdapter } from "./neverbounce";
import { notionAdapter } from "./notion";
import { nymeriaAdapter } from "./nymeria";
import { peopledatalabsAdapter } from "./peopledatalabs";
import { pinpointAdapter } from "./pinpoint";
import { pipedriveAdapter } from "./pipedrive";
import { prospeoAdapter } from "./prospeo";
import { recruitcrmAdapter } from "./recruitcrm";
import { recruiteeAdapter } from "./recruitee";
import { recruiterflowAdapter } from "./recruiterflow";
import { recruitisAdapter } from "./recruitis";
import { replyioAdapter } from "./replyio";
import { rocketreachAdapter } from "./rocketreach";
import { salesflareAdapter } from "./salesflare";
import { serpapiAdapter } from "./serpapi";
import { signalhireAdapter } from "./signalhire";
import { skrappAdapter } from "./skrapp";
import { slackAdapter } from "./slack";
import { smartleadAdapter } from "./smartlead";
import { smartrecruitersAdapter } from "./smartrecruiters";
import { snovAdapter } from "./snov";
import { stackexchangeAdapter } from "./stackexchange";
import { surfeAdapter } from "./surfe";
import { teamtailorAdapter } from "./teamtailor";
import { telegramAdapter } from "./telegram";
import { tldvAdapter } from "./tldv";
import { tombaAdapter } from "./tomba";
import { trestleAdapter } from "./trestle";
import { twilioAdapter } from "./twilio";
import { vincereAdapter } from "./vincere";
import { wizaAdapter } from "./wiza";
import { woodpeckerAdapter } from "./woodpecker";
import { workableAdapter } from "./workable";
import { zendeskSellAdapter } from "./zendesk-sell";
import { zerobounceAdapter } from "./zerobounce";
import { zohoCrmAdapter } from "./zoho-crm";
import { zohoRecruitAdapter } from "./zoho-recruit";
import { zoomAdapter } from "./zoom";
import type { ConnectorAdapter } from "./types";

export type { ConnectorAdapter, ResourceRef } from "./types";

// Registry of live connectors. Catalog display lives in lib/connectors.ts; this
// is the set with a working backend.
const ADAPTERS: Record<string, ConnectorAdapter> = {
  adzuna: adzunaAdapter,
  affinity: affinityAdapter,
  aircall: aircallAdapter,
  airtable: airtableAdapter,
  apollo: apolloAdapter,
  ashby: ashbyAdapter,
  attio: attioAdapter,
  avoma: avomaAdapter,
  bamboohr: bamboohrAdapter,
  bouncer: bouncerAdapter,
  breezyhr: breezyhrAdapter,
  brightdata: brightdataAdapter,
  bullhorn: bullhornAdapter,
  calcom: calcomAdapter,
  calendly: calendlyAdapter,
  capsule: capsuleAdapter,
  cats: catsAdapter,
  close: closeAdapter,
  contactout: contactoutAdapter,
  copper: copperAdapter,
  coresignal: coresignalAdapter,
  crelate: crelateAdapter,
  discord: discordAdapter,
  dropcontact: dropcontactAdapter,
  emailable: emailableAdapter,
  fathom: fathomAdapter,
  findymail: findymailAdapter,
  firecrawl: firecrawlAdapter,
  fireflies: firefliesAdapter,
  folk: folkAdapter,
  fullenrich: fullenrichAdapter,
  github: githubAdapter,
  gmail: gmailAdapter,
  gong: gongAdapter,
  "google-sheets": googleSheetsAdapter,
  grain: grainAdapter,
  greenhouse: greenhouseAdapter,
  hubspot: hubspotAdapter,
  hunter: hunterAdapter,
  insightly: insightlyAdapter,
  instantly: instantlyAdapter,
  jazzhr: jazzhrAdapter,
  jobadder: jobadderAdapter,
  "jobin-cloud": jobinAdapter,
  klenty: klentyAdapter,
  leadmagic: leadmagicAdapter,
  lemlist: lemlistAdapter,
  lever: leverAdapter,
  loxo: loxoAdapter,
  lusha: lushaAdapter,
  mailshake: mailshakeAdapter,
  manatal: manatalAdapter,
  messagebird: messagebirdAdapter,
  "microsoft-excel": microsoftExcelAdapter,
  "microsoft-outlook": microsoftOutlookAdapter,
  millionverifier: millionverifierAdapter,
  monday: mondayAdapter,
  neverbounce: neverbounceAdapter,
  notion: notionAdapter,
  nymeria: nymeriaAdapter,
  peopledatalabs: peopledatalabsAdapter,
  pinpoint: pinpointAdapter,
  pipedrive: pipedriveAdapter,
  prospeo: prospeoAdapter,
  recruitcrm: recruitcrmAdapter,
  recruitee: recruiteeAdapter,
  recruiterflow: recruiterflowAdapter,
  recruitis: recruitisAdapter,
  replyio: replyioAdapter,
  rocketreach: rocketreachAdapter,
  salesflare: salesflareAdapter,
  serpapi: serpapiAdapter,
  signalhire: signalhireAdapter,
  skrapp: skrappAdapter,
  slack: slackAdapter,
  smartlead: smartleadAdapter,
  smartrecruiters: smartrecruitersAdapter,
  snov: snovAdapter,
  stackexchange: stackexchangeAdapter,
  surfe: surfeAdapter,
  teamtailor: teamtailorAdapter,
  telegram: telegramAdapter,
  tldv: tldvAdapter,
  tomba: tombaAdapter,
  trestle: trestleAdapter,
  twilio: twilioAdapter,
  vincere: vincereAdapter,
  wiza: wizaAdapter,
  woodpecker: woodpeckerAdapter,
  workable: workableAdapter,
  "zendesk-sell": zendeskSellAdapter,
  zerobounce: zerobounceAdapter,
  "zoho-crm": zohoCrmAdapter,
  "zoho-recruit": zohoRecruitAdapter,
  zoom: zoomAdapter,
};

export function getAdapter(provider: string): ConnectorAdapter | null {
  return ADAPTERS[provider] ?? null;
}

export function isLiveConnector(provider: string): boolean {
  return provider in ADAPTERS;
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute early to avoid edge races

/**
 * Returns a usable access token for a connection, refreshing (and persisting the
 * rotated single-use refresh token) when the stored one is expired or near it.
 * Marks the connection status='error' on failure so the UI can prompt a reconnect.
 */
export async function getValidAccessToken(
  connection: Connection,
): Promise<string> {
  const adapter = getAdapter(connection.provider);
  if (!adapter) throw new Error(`No adapter for ${connection.provider}`);
  if (!connection.access_token_cipher) {
    await markError(connection.id);
    throw new Error(`${connection.provider} is not connected. Reconnect it in Settings → Connectors.`);
  }

  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : null;
  const expired = expiresAt !== null && expiresAt - EXPIRY_SKEW_MS <= Date.now();

  if (!expired) {
    try {
      return decrypt(connection.access_token_cipher);
    } catch {
      // fall through to refresh below
    }
  }

  // API-key connectors never expire and have no refresh path — a decrypt
  // failure above is terminal.
  if (adapter.authType !== "oauth" || !adapter.refreshToken) {
    await markError(connection.id);
    throw new Error(
      `Your ${connection.provider} connection couldn't be read. Reconnect it in Settings → Connectors.`,
    );
  }
  if (!connection.refresh_token_cipher) {
    await markError(connection.id);
    throw new Error(
      `Your ${connection.provider} connection expired. Reconnect it in Settings → Connectors.`,
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(connection.refresh_token_cipher);
  } catch {
    await markError(connection.id);
    throw new Error(
      `Your ${connection.provider} connection couldn't be read. Reconnect it in Settings → Connectors.`,
    );
  }

  // BYO-OAuth connectors refresh against the workspace's own app credentials.
  let app: { clientId: string; clientSecret?: string } | undefined;
  if (connection.oauth_client_id) {
    app = { clientId: connection.oauth_client_id };
    if (connection.oauth_client_secret_cipher) {
      try {
        app.clientSecret = decrypt(connection.oauth_client_secret_cipher);
      } catch {
        // Secret unreadable — fall back to a public-client refresh.
      }
    }
  }

  try {
    const tokens = await adapter.refreshToken!(refreshToken, app);
    await db()
      .from("workspace_connections")
      .update({
        access_token_cipher: encrypt(tokens.accessToken),
        // Persist the rotated refresh token; keep the old one if none returned.
        refresh_token_cipher: tokens.refreshToken
          ? encrypt(tokens.refreshToken)
          : connection.refresh_token_cipher,
        token_expires_at: tokens.expiresAt,
        scopes: tokens.scopes ?? connection.scopes,
        status: "active",
      })
      .eq("id", connection.id);
    return tokens.accessToken;
  } catch (error) {
    await markError(connection.id);
    throw new Error(
      `Couldn't refresh your ${connection.provider} connection (${
        error instanceof Error ? error.message : "unknown error"
      }). Reconnect it in Settings → Connectors.`,
    );
  }
}

async function markError(connectionId: string): Promise<void> {
  await db()
    .from("workspace_connections")
    .update({ status: "error" })
    .eq("id", connectionId);
}
