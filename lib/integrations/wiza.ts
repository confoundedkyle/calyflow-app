import "server-only";
import type { ConnectorAdapter } from "./types";

// Wiza (LinkedIn-centric email + phone reveal). Auth is a static API key
// (Wiza: app → API) sent as a Bearer token. Like Dropcontact/FullEnrich a
// reveal is async: POST /individual_reveals returns a data.id and
// GET /individual_reveals/{id} is polled until data.is_complete (status
// finished/failed) — the same pending/poll shape as the other waterfall
// enrichers. Input is one of a LinkedIn profile_url, an email, or a
// full_name + company/domain. validateApiKey GETs a dummy id and treats
// 401/403 as a bad key (credit-free), since there's no list endpoint.
const API = "https://wiza.co/api";

export interface WizaContact {
  fullName?: string;
  company?: string;
  domain?: string;
  linkedinUrl?: string;
  email?: string;
}

interface RevealData {
  id?: number | string;
  status?: string;
  is_complete?: boolean;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  mobile_phone?: string | null;
  phone_number?: string | null;
}
interface RevealResponse {
  data?: RevealData;
  status?: { code?: number; message?: string };
  message?: string;
  error?: string;
}

export interface WizaAdapter extends ConnectorAdapter {
  reveal(
    apiKey: string,
    contact: WizaContact,
  ): Promise<{ text: string; pending: boolean }>;
  getResult(
    apiKey: string,
    args: { revealId: string },
  ): Promise<{ text: string; pending: boolean }>;
}

async function request(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<RevealResponse> {
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
  const json = (await res.json().catch(() => null)) as RevealResponse | null;
  if (!res.ok) {
    const detail =
      json?.status?.message ?? json?.message ?? json?.error ?? res.statusText;
    throw new Error(`Wiza error (${res.status}): ${detail}`);
  }
  return json ?? {};
}

function renderData(d: RevealData): string {
  const phone = d.mobile_phone ?? d.phone_number;
  const headline = [
    `**${d.name || "Unknown"}**`,
    d.title ? `— ${d.title}` : "",
    d.company ? `at ${d.company}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [headline];
  if (d.email) lines.push(`Email: ${d.email}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (!d.email && !phone) lines.push("_No email or phone found._");
  return lines.join("\n");
}

export const wizaAdapter: WizaAdapter = {
  provider: "wiza",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // No list/account endpoint — GET a dummy id and read the status code:
    // 401/403 means a bad key; anything else (404 for the unknown id) means
    // the key authenticated. Consumes no credits.
    try {
      const res = await fetch(`${API}/individual_reveals/0`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Wiza rejected the API key (check it in the Wiza app → API)." };
      }
      return { ok: true, accountLabel: "Wiza" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async reveal(apiKey, contact) {
    const input: Record<string, string> = {};
    if (contact.linkedinUrl) input.profile_url = contact.linkedinUrl;
    else if (contact.email) input.email = contact.email;
    else if (contact.fullName && (contact.company || contact.domain)) {
      input.full_name = contact.fullName;
      if (contact.company) input.company = contact.company;
      if (contact.domain) input.domain = contact.domain;
    }
    if (Object.keys(input).length === 0) {
      return {
        text: "Provide a linkedinUrl, an email, or a fullName with a company or domain.",
        pending: false,
      };
    }
    const started = await request(apiKey, "POST", "/individual_reveals", {
      individual_reveal: input,
      enrichment_level: "full",
      email_options: { accept_work: true, accept_personal: true },
    });
    const id = started.data?.id;
    if (id == null) {
      return { text: started.status?.message ?? "Wiza did not return a reveal id.", pending: false };
    }
    return {
      text: `Wiza started the reveal (reveal id ${id}). Call wiza_get_result with that id in a few seconds to read the email and phone.`,
      pending: true,
    };
  },

  async getResult(apiKey, args) {
    if (!args.revealId) return { text: "Provide the revealId.", pending: false };
    const json = await request(
      apiKey,
      "GET",
      `/individual_reveals/${encodeURIComponent(args.revealId)}`,
    );
    const d = json.data ?? {};
    const done = d.is_complete === true || d.status === "finished" || d.status === "failed";
    if (!done) {
      return {
        text: `Wiza is still revealing this contact (reveal id ${
          d.id ?? args.revealId
        }, status ${d.status ?? "pending"}). Call wiza_get_result again after working on something else for a moment.`,
        pending: true,
      };
    }
    if (d.status === "failed") {
      return { text: "Wiza could not reveal this contact (the reveal failed).", pending: false };
    }
    return { text: renderData(d), pending: false };
  },
};
