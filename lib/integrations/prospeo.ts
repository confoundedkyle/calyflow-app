import "server-only";
import type { ConnectorAdapter } from "./types";

// Prospeo (verified email + mobile finder). Auth is a static API key sent as an
// X-KEY header. Every response carries an `error` boolean (false = success) and
// a `response` payload, so the helper throws on HTTP errors and each op treats
// error:true as a logical miss (e.g. no verified email / insufficient credits).
// Lookups are synchronous: POST /enrich-person finds a verified email from a
// full name + company website (or a LinkedIn URL), POST /mobile-finder finds a
// mobile from a LinkedIn URL, and GET /account-information returns the credit
// balance for validation.
const API = "https://api.prospeo.io";

export interface ProspeoAdapter extends ConnectorAdapter {
  enrichPerson(
    apiKey: string,
    args: { fullName?: string; companyWebsite?: string; linkedinUrl?: string },
  ): Promise<{ text: string; found: boolean }>;
  findMobile(
    apiKey: string,
    args: { linkedinUrl: string },
  ): Promise<{ text: string; found: boolean }>;
}

interface ProspeoResponse {
  error?: boolean;
  message?: string;
  response?: {
    email?: string | null;
    email_status?: string | null;
    full_name?: string | null;
    company?: string | null;
    raw_format?: string | null;
    international_format?: string | null;
    phone?: string | null;
    remaining_credits?: number;
  } | null;
}

async function call(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<ProspeoResponse> {
  const init: RequestInit = {
    method,
    headers: {
      "X-KEY": apiKey,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const json = (await res.json().catch(() => null)) as ProspeoResponse | null;
  if (!res.ok) {
    const detail = json?.message ?? res.statusText;
    throw new Error(`Prospeo error (${res.status}): ${detail}`);
  }
  return json ?? {};
}

export const prospeoAdapter: ProspeoAdapter = {
  provider: "prospeo",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await call(apiKey, "GET", "/account-information");
      if (json.error) {
        return { ok: false, message: json.message ?? "Prospeo rejected the API key." };
      }
      const credits = json.response?.remaining_credits;
      return {
        ok: true,
        accountLabel:
          typeof credits === "number" ? `Prospeo (${credits} credits)` : "Prospeo",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async enrichPerson(apiKey, args) {
    const data: Record<string, string> = {};
    if (args.fullName) data.full_name = args.fullName;
    if (args.companyWebsite) data.company_website = args.companyWebsite;
    if (args.linkedinUrl) data.linkedin_url = args.linkedinUrl;
    if (!data.full_name && !data.linkedin_url) {
      return {
        text: "Provide a fullName with a companyWebsite, or a linkedinUrl.",
        found: false,
      };
    }
    const json = await call(apiKey, "POST", "/enrich-person", {
      only_verified_email: true,
      data,
    });
    if (json.error || !json.response?.email) {
      return {
        text: `No verified email found${json.message ? ` (${json.message})` : ""}.`,
        found: false,
      };
    }
    const r = json.response;
    const name = r.full_name ?? args.fullName;
    const headline = `**${r.email}**${r.email_status ? ` (${r.email_status})` : ""}`;
    const detail = [name && `name: ${name}`, r.company && `company: ${r.company}`]
      .filter(Boolean)
      .join(" · ");
    return { text: `${headline}${detail ? `\n${detail}` : ""}`, found: true };
  },

  async findMobile(apiKey, args) {
    if (!args.linkedinUrl) return { text: "Provide a linkedinUrl.", found: false };
    const json = await call(apiKey, "POST", "/mobile-finder", { url: args.linkedinUrl });
    const phone =
      json.response?.raw_format ??
      json.response?.international_format ??
      json.response?.phone;
    if (json.error || !phone) {
      return {
        text: `No mobile found${json.message ? ` (${json.message})` : ""}.`,
        found: false,
      };
    }
    return { text: `**${phone}**`, found: true };
  },
};
