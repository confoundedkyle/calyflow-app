import "server-only";
import type { ConnectorAdapter } from "./types";

// Trestle (phone validation / QA). Auth is an API key sent as an x-api-key
// header. The single read is the Phone Validation API
// (GET /3.1/phone?phone=...), which returns whether a number is valid plus its
// line type (Mobile / Landline / NonFixedVOIP / …), carrier, and an
// activity_score (0–100, recent activity) — useful for cleaning candidate phone
// lists before a calling campaign. validateApiKey runs a probe lookup and reads
// the status code (401/403 = bad key).
const API = "https://api.trestleiq.com";

function headers(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, Accept: "application/json" };
}

export interface TrestleAdapter extends ConnectorAdapter {
  validatePhone(
    apiKey: string,
    args: { phone: string },
  ): Promise<{ text: string; valid: boolean }>;
}

interface PhoneResponse {
  phone_number?: string | null;
  is_valid?: boolean | null;
  activity_score?: number | null;
  line_type?: string | null;
  carrier?: string | null;
  error?: { message?: string | null } | null;
  message?: string | null;
}

export const trestleAdapter: TrestleAdapter = {
  provider: "trestle",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const res = await fetch(`${API}/3.1/phone?phone=${encodeURIComponent("+12025550123")}`, {
        headers: headers(apiKey),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Trestle rejected the API key (check it in your account → API)." };
      }
      return { ok: true, accountLabel: "Trestle" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async validatePhone(apiKey, args) {
    if (!args.phone) return { text: "Provide a phone number (E.164, e.g. +14155551234).", valid: false };
    const res = await fetch(`${API}/3.1/phone?phone=${encodeURIComponent(args.phone)}`, {
      headers: headers(apiKey),
    });
    const json = (await res.json().catch(() => null)) as PhoneResponse | null;
    if (!res.ok) {
      const detail = json?.error?.message ?? json?.message ?? res.statusText;
      throw new Error(`Trestle error (${res.status}): ${detail}`);
    }
    const valid = json?.is_valid === true;
    const parts = [
      valid ? "valid" : "invalid",
      json?.line_type ? `line: ${json.line_type}` : null,
      json?.carrier ? `carrier: ${json.carrier}` : null,
      json?.activity_score != null ? `activity: ${json.activity_score}/100` : null,
    ].filter(Boolean);
    return {
      text: `${json?.phone_number ?? args.phone}: ${parts.join(" · ")}`,
      valid,
    };
  },
};
