import "server-only";
import type { ConnectorAdapter } from "./types";

// Nymeria (person enrichment from a LinkedIn profile or email). Auth is a static
// API key sent as an X-Api-Key header. The single read is a synchronous
// GET /person/enrich keyed by a LinkedIn profile URL (`profile`) or an `email`,
// returning { status, data } where data has work_email / personal_emails /
// mobile_phone plus job + company. A 404 means no match (not an error), so it's
// surfaced as a miss rather than thrown. validateApiKey calls enrich with no
// identifier and treats 401/403 as a bad key — credit-free, since no record is
// resolved without an identifier.
const API = "https://www.nymeria.io/api/v4";

export interface NymeriaAdapter extends ConnectorAdapter {
  enrichPerson(
    apiKey: string,
    args: { linkedinUrl?: string; email?: string },
  ): Promise<{ text: string; found: boolean }>;
}

interface NymeriaData {
  first_name?: string | null;
  last_name?: string | null;
  work_email?: string | null;
  personal_emails?: string[] | null;
  mobile_phone?: string | null;
  job_title?: string | null;
  job_company_name?: string | null;
}

function headers(apiKey: string): Record<string, string> {
  return { "X-Api-Key": apiKey, Accept: "application/json" };
}

async function rawGet(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<Response> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, v);
  const qs = sp.toString();
  return fetch(`${API}${path}${qs ? `?${qs}` : ""}`, { headers: headers(apiKey) });
}

export const nymeriaAdapter: NymeriaAdapter = {
  provider: "nymeria",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // No account endpoint — call enrich with no identifier: 401/403 means a bad
    // key, anything else (a 400/422 for the missing identifier) means authed.
    try {
      const res = await rawGet(apiKey, "/person/enrich");
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Nymeria rejected the API key (check it in the app → API)." };
      }
      return { ok: true, accountLabel: "Nymeria" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async enrichPerson(apiKey, args) {
    if (!args.linkedinUrl && !args.email) {
      return { text: "Provide a linkedinUrl or an email.", found: false };
    }
    const res = await rawGet(apiKey, "/person/enrich", {
      profile: args.linkedinUrl,
      email: args.email,
    });
    if (res.status === 404) {
      return { text: "No match found for that profile or email.", found: false };
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: NymeriaData; message?: string }
      | null;
    if (!res.ok) {
      throw new Error(`Nymeria error (${res.status}): ${json?.message ?? res.statusText}`);
    }
    const d = json?.data;
    const email = d?.work_email ?? d?.personal_emails?.[0];
    if (!d || (!email && !d.mobile_phone)) {
      return { text: "No contact details found for that profile or email.", found: false };
    }
    const name = [d.first_name, d.last_name].filter(Boolean).join(" ");
    const headline = [
      `**${name || "Unknown"}**`,
      d.job_title ? `— ${d.job_title}` : "",
      d.job_company_name ? `at ${d.job_company_name}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const lines = [headline];
    if (email) lines.push(`Email: ${email}`);
    if (d.mobile_phone) lines.push(`Phone: ${d.mobile_phone}`);
    return { text: lines.join("\n"), found: true };
  },
};
