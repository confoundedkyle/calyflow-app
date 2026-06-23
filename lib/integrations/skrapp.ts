import "server-only";
import type { ConnectorAdapter } from "./types";

// Skrapp (B2B email finder). Auth is an API key sent as an X-Access-Key header.
// The single read finds a work email from a name + company domain
// (GET /api/v2/find), returning the email and a quality signal (whose shape
// varies — a string or a { status } object — so rendering reads it tolerantly).
// validateApiKey runs a probe lookup and reads the status code (401/403 = bad
// key), which is robust without depending on a separate account endpoint.
const API = "https://api.skrapp.io";

function headers(apiKey: string): Record<string, string> {
  return { "X-Access-Key": apiKey, Accept: "application/json" };
}

interface FindResponse {
  email?: string | null;
  quality?: { status?: string | null } | string | null;
  company?: string | null;
  message?: string | null;
}

export interface SkrappAdapter extends ConnectorAdapter {
  findEmail(
    apiKey: string,
    args: { firstName: string; lastName: string; domain: string },
  ): Promise<{ text: string; found: boolean }>;
}

function qualityLabel(quality: FindResponse["quality"]): string {
  if (!quality) return "";
  if (typeof quality === "string") return quality;
  return quality.status ?? "";
}

export const skrappAdapter: SkrappAdapter = {
  provider: "skrapp",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const sp = new URLSearchParams({
        firstName: "Connection",
        lastName: "Check",
        domain: "example.com",
      });
      const res = await fetch(`${API}/api/v2/find?${sp.toString()}`, {
        headers: headers(apiKey),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Skrapp rejected the API key (it requires a premium account; check it under Settings → API)." };
      }
      return { ok: true, accountLabel: "Skrapp" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async findEmail(apiKey, args) {
    if (!args.firstName || !args.lastName || !args.domain) {
      return { text: "Provide firstName, lastName, and domain.", found: false };
    }
    const sp = new URLSearchParams({
      firstName: args.firstName,
      lastName: args.lastName,
      domain: args.domain,
    });
    const res = await fetch(`${API}/api/v2/find?${sp.toString()}`, {
      headers: headers(apiKey),
    });
    const json = (await res.json().catch(() => null)) as FindResponse | null;
    if (!res.ok) {
      throw new Error(`Skrapp error (${res.status}): ${json?.message ?? res.statusText}`);
    }
    if (!json?.email) {
      return { text: `No email found for ${args.firstName} ${args.lastName} at ${args.domain}.`, found: false };
    }
    const detail = [
      qualityLabel(json.quality) && `quality: ${qualityLabel(json.quality)}`,
      json.company && `company: ${json.company}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return { text: `**${json.email}**${detail ? `\n${detail}` : ""}`, found: true };
  },
};
