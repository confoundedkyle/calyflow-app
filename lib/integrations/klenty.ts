import "server-only";
import type { ConnectorAdapter } from "./types";

// Klenty (sales-engagement / cadences). Auth needs an API key plus the email of
// the Klenty user it belongs to — every endpoint is scoped by that email in the
// path (/user/{email}/...) — so, like Copper/Recruitee, the stored credential
// is the user-pasted pair "email:api-key" and validateApiKey teaches the format
// on miss. The key goes in the x-API-key header. Reads are the user's cadences
// (GET /user/{email}/cadences) and a single prospect by email
// (GET /user/{email}/{prospectEmail}).
const API = "https://app.klenty.com/apis/v1";

const CHAR_CAP = 12_000;

const CREDENTIAL_HINT =
  'Paste the credential as "your-login-email:api-key" — the key is in Klenty under Settings → API, and the email is the Klenty user it belongs to.';

export interface KlentyCadence {
  id?: string | number;
  cadenceId?: string | number;
  name?: string | null;
  cadenceName?: string | null;
}

export interface KlentyProspect {
  Email?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  FullName?: string | null;
  Company?: string | null;
  Title?: string | null;
  Phone?: string | null;
  LinkedinURL?: string | null;
  prospectStatus?: string | null;
}

export interface KlentyAdapter extends ConnectorAdapter {
  listCadences(
    credential: string,
  ): Promise<{ text: string; count: number }>;
  getProspect(
    credential: string,
    args: { email: string },
  ): Promise<{ text: string; found: boolean }>;
}

function parseCredential(
  credential: string,
): { email: string; key: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const email = credential.slice(0, i).trim();
  const key = credential.slice(i + 1).trim();
  if (!email || !key || !email.includes("@")) return null;
  return { email, key };
}

async function get<T>(credential: string, subpath: string): Promise<T> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Klenty credential is malformed. ${CREDENTIAL_HINT}`);
  const res = await fetch(
    `${API}/user/${encodeURIComponent(parsed.email)}${subpath}`,
    { headers: { "x-API-key": parsed.key, Accept: "application/json" } },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Klenty error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const klentyAdapter: KlentyAdapter = {
  provider: "klenty",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      await get<unknown>(credential, "/cadences");
      const email = parseCredential(credential)?.email;
      return { ok: true, accountLabel: email ? `Klenty (${email})` : "Klenty" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listCadences(credential) {
    const json = await get<KlentyCadence[] | { cadences?: KlentyCadence[] }>(
      credential,
      "/cadences",
    );
    const cadences = Array.isArray(json) ? json : (json.cadences ?? []);
    const lines = ["| Cadence | Cadence ID |", "| --- | --- |"];
    for (const c of cadences) {
      lines.push(`| ${cell(c.name ?? c.cadenceName)} | ${cell(c.id ?? c.cadenceId)} |`);
      if (lines.join("\n").length > CHAR_CAP) break;
    }
    return {
      text: cadences.length ? lines.join("\n") : "_No cadences._",
      count: cadences.length,
    };
  },

  async getProspect(credential, args) {
    if (!args.email) return { text: "Provide the prospect's email.", found: false };
    const json = await get<KlentyProspect | KlentyProspect[]>(
      credential,
      `/${encodeURIComponent(args.email)}`,
    );
    const p = Array.isArray(json) ? json[0] : json;
    if (!p?.Email) {
      return { text: `No prospect found for ${args.email}.`, found: false };
    }
    const name = p.FullName ?? [p.FirstName, p.LastName].filter(Boolean).join(" ");
    const headline = [
      `**${name || p.Email}**`,
      p.Title ? `— ${p.Title}` : "",
      p.Company ? `at ${p.Company}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const lines = [headline, `Email: ${p.Email}`];
    if (p.Phone) lines.push(`Phone: ${p.Phone}`);
    if (p.LinkedinURL) lines.push(`LinkedIn: ${p.LinkedinURL}`);
    if (p.prospectStatus) lines.push(`Status: ${p.prospectStatus}`);
    return { text: lines.join("\n"), found: true };
  },
};
