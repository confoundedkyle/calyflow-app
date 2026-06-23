import "server-only";
import type { ConnectorAdapter } from "./types";

// Insightly (CRM). Auth is a per-user API key sent via HTTP Basic with the key
// as the username and an empty password. The API host is region-specific
// ("pod") and shown next to the key in User Settings, and no endpoint reveals
// it — so, like Recruitee/Loxo, the stored credential is the user-pasted pair
// "pod:api-key" (e.g. na1:abc…) and validateApiKey teaches the format on miss.
// Reads are Contacts, Organisations, and Opportunities (bare arrays, top/skip
// paging); emails and phones live in a CONTACTINFOS array of typed entries.
const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

const CREDENTIAL_HINT =
  'Paste the credential as "pod:api-key" — the pod is in your API URL under User Settings → API (e.g. the "na1" in api.na1.insightly.com); the key is shown there too.';

interface ContactInfo {
  TYPE?: string | null;
  DETAIL?: string | null;
}
export interface InsightlyContact {
  CONTACT_ID?: number;
  FIRST_NAME?: string | null;
  LAST_NAME?: string | null;
  TITLE?: string | null;
  ORGANISATION_NAME?: string | null;
  EMAIL_ADDRESS?: string | null;
  CONTACTINFOS?: ContactInfo[] | null;
}
export interface InsightlyOrganisation {
  ORGANISATION_ID?: number;
  ORGANISATION_NAME?: string | null;
  CONTACTINFOS?: ContactInfo[] | null;
}
export interface InsightlyOpportunity {
  OPPORTUNITY_ID?: number;
  OPPORTUNITY_NAME?: string | null;
  OPPORTUNITY_VALUE?: number | null;
  BID_CURRENCY?: string | null;
  OPPORTUNITY_STATE?: string | null;
}

export interface InsightlyAdapter extends ConnectorAdapter {
  listContacts(
    credential: string,
    args?: { limit?: number; skip?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listOrganisations(
    credential: string,
    args?: { limit?: number; skip?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listOpportunities(
    credential: string,
    args?: { limit?: number; skip?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

function parseCredential(
  credential: string,
): { pod: string; key: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const pod = credential.slice(0, i).trim();
  const key = credential.slice(i + 1).trim();
  if (!pod || !key || !/^[a-z0-9]+$/i.test(pod)) return null;
  return { pod, key };
}

async function get<T>(
  credential: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Insightly credential is malformed. ${CREDENTIAL_HINT}`);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const auth = Buffer.from(`${parsed.key}:`).toString("base64");
  const res = await fetch(
    `https://api.${parsed.pod}.insightly.com/v3.1${path}${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { Message?: string } | null)?.Message ?? res.statusText;
    throw new Error(`Insightly error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function infoOf(infos: ContactInfo[] | null | undefined, type: string): string {
  const hit = (infos ?? []).find((i) =>
    (i.TYPE ?? "").toUpperCase().includes(type),
  );
  return hit?.DETAIL ?? "";
}

export const insightlyAdapter: InsightlyAdapter = {
  provider: "insightly",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      const me = await get<{ FIRST_NAME?: string | null; LAST_NAME?: string | null; EMAIL_ADDRESS?: string | null }>(
        credential,
        "/Users/Me",
      );
      const label = [me.FIRST_NAME, me.LAST_NAME].filter(Boolean).join(" ") || me.EMAIL_ADDRESS;
      return { ok: true, accountLabel: label ? `Insightly (${label})` : "Insightly" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listContacts(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const rows = await get<InsightlyContact[]>(credential, "/Contacts", {
      top: limit,
      skip: args?.skip,
      brief: "false",
    });
    const contacts = Array.isArray(rows) ? rows : [];
    const lines = [
      "| Name | Email | Phone | Company | Title | Contact ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of contacts) {
      const name = [c.FIRST_NAME, c.LAST_NAME].filter(Boolean).join(" ");
      const email = c.EMAIL_ADDRESS || infoOf(c.CONTACTINFOS, "EMAIL");
      lines.push(
        `| ${cell(name)} | ${cell(email)} | ${cell(
          infoOf(c.CONTACTINFOS, "PHONE"),
        )} | ${cell(c.ORGANISATION_NAME)} | ${cell(c.TITLE)} | ${cell(
          c.CONTACT_ID,
        )} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: contacts.length ? lines.join("\n") : "_No contacts found._",
      count: contacts.length,
      truncated: truncated || contacts.length >= limit,
    };
  },

  async listOrganisations(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const rows = await get<InsightlyOrganisation[]>(credential, "/Organisations", {
      top: limit,
      skip: args?.skip,
      brief: "false",
    });
    const orgs = Array.isArray(rows) ? rows : [];
    const lines = ["| Company | Phone | Organisation ID |", "| --- | --- | --- |"];
    let truncated = false;
    for (const o of orgs) {
      lines.push(
        `| ${cell(o.ORGANISATION_NAME)} | ${cell(
          infoOf(o.CONTACTINFOS, "PHONE"),
        )} | ${cell(o.ORGANISATION_ID)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: orgs.length ? lines.join("\n") : "_No organisations found._",
      count: orgs.length,
      truncated: truncated || orgs.length >= limit,
    };
  },

  async listOpportunities(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const rows = await get<InsightlyOpportunity[]>(credential, "/Opportunities", {
      top: limit,
      skip: args?.skip,
      brief: "false",
    });
    const opps = Array.isArray(rows) ? rows : [];
    const lines = [
      "| Opportunity | Value | State | Opportunity ID |",
      "| --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const o of opps) {
      const value =
        o.OPPORTUNITY_VALUE != null
          ? `${o.OPPORTUNITY_VALUE}${o.BID_CURRENCY ? ` ${o.BID_CURRENCY}` : ""}`
          : "";
      lines.push(
        `| ${cell(o.OPPORTUNITY_NAME)} | ${cell(value)} | ${cell(
          o.OPPORTUNITY_STATE,
        )} | ${cell(o.OPPORTUNITY_ID)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    return {
      text: opps.length ? lines.join("\n") : "_No opportunities found._",
      count: opps.length,
      truncated: truncated || opps.length >= limit,
    };
  },
};
