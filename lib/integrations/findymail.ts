import "server-only";
import type { ConnectorAdapter } from "./types";

// Findymail (verified B2B email + mobile finder with built-in verification).
// Auth is a static API key (Findymail: app → API) sent as a Bearer token.
// Unlike the waterfall enrichers (Dropcontact/FullEnrich) the lookups are
// synchronous: POST /search/name finds an email from a name + company domain,
// POST /search/phone finds a mobile from a LinkedIn URL, and POST /verify
// checks deliverability. validateApiKey reads GET /credits (finder + verifier
// balances) and labels the connection with the remaining finder credits.
// Finder hits return a `contact` object; misses return it null.
const API = "https://app.findymail.com/api";

interface FindymailContact {
  name?: string | null;
  email?: string | null;
  domain?: string | null;
  phone?: string | null;
}

export interface FindymailAdapter extends ConnectorAdapter {
  findEmail(
    apiKey: string,
    args: { name: string; domain: string },
  ): Promise<{ text: string; found: boolean }>;
  findPhone(
    apiKey: string,
    args: { linkedinUrl: string },
  ): Promise<{ text: string; found: boolean }>;
  verifyEmail(
    apiKey: string,
    args: { email: string },
  ): Promise<{ text: string; ok: boolean }>;
}

async function call<T>(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Findymail error (${res.status}): ${detail}`);
  }
  return json as T;
}

export const findymailAdapter: FindymailAdapter = {
  provider: "findymail",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await call<{ credits?: number; verifier_credits?: number }>(
        apiKey,
        "GET",
        "/credits",
      );
      const credits = json.credits;
      return {
        ok: true,
        accountLabel:
          typeof credits === "number"
            ? `Findymail (${credits} finder credits)`
            : "Findymail",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async findEmail(apiKey, args) {
    if (!args.name || !args.domain) {
      return { text: "Provide both name and domain.", found: false };
    }
    const json = await call<{ contact?: FindymailContact | null }>(
      apiKey,
      "POST",
      "/search/name",
      { name: args.name, domain: args.domain },
    );
    const c = json.contact;
    if (!c?.email) {
      return { text: `No email found for ${args.name} at ${args.domain}.`, found: false };
    }
    const detail = [c.name && `name: ${c.name}`, c.domain && `domain: ${c.domain}`]
      .filter(Boolean)
      .join(" · ");
    return { text: `**${c.email}**${detail ? `\n${detail}` : ""}`, found: true };
  },

  async findPhone(apiKey, args) {
    if (!args.linkedinUrl) {
      return { text: "Provide a linkedinUrl.", found: false };
    }
    const json = await call<{ contact?: FindymailContact | null; phone?: string | null }>(
      apiKey,
      "POST",
      "/search/phone",
      { linkedin_url: args.linkedinUrl },
    );
    const phone = json.contact?.phone ?? json.phone;
    if (!phone) {
      return { text: "No phone found for that LinkedIn profile.", found: false };
    }
    return { text: `**${phone}**`, found: true };
  },

  async verifyEmail(apiKey, args) {
    if (!args.email) return { text: "Provide an email.", ok: false };
    const json = await call<{
      email?: string | null;
      verified?: boolean;
      provider?: string | null;
    }>(apiKey, "POST", "/verify", { email: args.email });
    const status = json.verified ? "deliverable" : "undeliverable / risky";
    const provider = json.provider ? ` (provider: ${json.provider})` : "";
    return {
      text: `${json.email ?? args.email}: ${status}${provider}`,
      ok: json.verified === true,
    };
  },
};
