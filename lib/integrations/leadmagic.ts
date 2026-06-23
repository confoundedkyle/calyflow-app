import "server-only";
import type { ConnectorAdapter } from "./types";

// LeadMagic (pay-per-valid B2B email finder + validator). Auth is a static API
// key sent as an X-API-Key header. Lookups are synchronous: POST
// /v1/people/email-finder finds a work email from a name + company (you only
// pay when a valid email is found), and POST /v1/people/email-validation checks
// deliverability. validateApiKey runs a deliberately-empty finder lookup and
// treats 401/403 as a bad key — the not-found path is free, so the check
// consumes no credits.
const API = "https://api.leadmagic.io";

export interface LeadmagicAdapter extends ConnectorAdapter {
  findEmail(
    apiKey: string,
    args: { firstName?: string; lastName?: string; fullName?: string; domain?: string; companyName?: string },
  ): Promise<{ text: string; found: boolean }>;
  verifyEmail(
    apiKey: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

interface LeadmagicResponse {
  email?: string | null;
  status?: string | null;
  email_status?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  message?: string | null;
  error?: string | null;
}

async function post(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<LeadmagicResponse> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as LeadmagicResponse | null;
  if (!res.ok) {
    const detail = json?.message ?? json?.error ?? res.statusText;
    throw new Error(`LeadMagic error (${res.status}): ${detail}`);
  }
  return json ?? {};
}

export const leadmagicAdapter: LeadmagicAdapter = {
  provider: "leadmagic",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // A not-found finder lookup is free; 401/403 means a bad key.
    try {
      const res = await fetch(`${API}/v1/people/email-finder`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ first_name: "connection", last_name: "check", domain: "example.com" }),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "LeadMagic rejected the API key (check it in the app → API)." };
      }
      return { ok: true, accountLabel: "LeadMagic" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async findEmail(apiKey, args) {
    const hasName = args.firstName || args.lastName || args.fullName;
    const hasCompany = args.domain || args.companyName;
    if (!hasName || !hasCompany) {
      return {
        text: "Provide a name (firstName + lastName, or fullName) and a company (domain or companyName).",
        found: false,
      };
    }
    const json = await post(apiKey, "/v1/people/email-finder", {
      first_name: args.firstName,
      last_name: args.lastName,
      full_name: args.fullName,
      domain: args.domain,
      company_name: args.companyName,
    });
    if (!json.email) {
      return {
        text: `No email found${json.message ? ` (${json.message})` : ""}.`,
        found: false,
      };
    }
    const name = [json.first_name, json.last_name].filter(Boolean).join(" ");
    const headline = `**${json.email}**${json.status ? ` (${json.status})` : ""}`;
    const detail = [name && `name: ${name}`, json.company_name && `company: ${json.company_name}`]
      .filter(Boolean)
      .join(" · ");
    return { text: `${headline}${detail ? `\n${detail}` : ""}`, found: true };
  },

  async verifyEmail(apiKey, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const json = await post(apiKey, "/v1/people/email-validation", { email: args.email });
    const status = json.email_status ?? json.status ?? "unknown";
    return { text: `${args.email}: ${status}`, ok: status === "valid" };
  },
};
