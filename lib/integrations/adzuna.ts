import "server-only";
import type { ConnectorAdapter } from "./types";

// Adzuna (job-market data — listings + salary stats across many countries).
// Auth is an app_id / app_key pair (Adzuna: developer.adzuna.com), passed as
// query params, so — like Snov/Gong — the stored credential is the user-pasted
// pair "app-id:app-key" and validateApiKey teaches the format on miss. Reads
// are job search (GET /jobs/{country}/search/{page}) and the salary histogram
// (GET /jobs/{country}/histogram), both scoped to a country code (default gb).
const API = "https://api.adzuna.com/v1/api";

const DEFAULT_LIMIT = 20;
const HARD_LIMIT = 50;
const CHAR_CAP = 12_000;
const DEFAULT_COUNTRY = "gb";

const CREDENTIAL_HINT =
  'Paste the credential as "app-id:app-key" — register for both at developer.adzuna.com.';

export interface AdzunaJob {
  title?: string | null;
  company?: { display_name?: string | null } | null;
  location?: { display_name?: string | null } | null;
  salary_min?: number | null;
  salary_max?: number | null;
  contract_time?: string | null;
  created?: string | null;
  redirect_url?: string | null;
}

export interface AdzunaAdapter extends ConnectorAdapter {
  searchJobs(
    credential: string,
    args?: {
      country?: string;
      what?: string;
      where?: string;
      salaryMin?: number;
      limit?: number;
      page?: number;
    },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  salaryHistogram(
    credential: string,
    args: { what: string; country?: string; where?: string },
  ): Promise<{ text: string }>;
}

function parseCredential(
  credential: string,
): { appId: string; appKey: string } | null {
  const i = credential.indexOf(":");
  if (i <= 0 || i === credential.length - 1) return null;
  const appId = credential.slice(0, i).trim();
  const appKey = credential.slice(i + 1).trim();
  if (!appId || !appKey) return null;
  return { appId, appKey };
}

async function get<T>(
  credential: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Adzuna credential is malformed. ${CREDENTIAL_HINT}`);
  const sp = new URLSearchParams();
  sp.set("app_id", parsed.appId);
  sp.set("app_key", parsed.appKey);
  sp.set("content-type", "application/json");
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const res = await fetch(`${API}${path}?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { exception?: string } | null)?.exception ??
      (json as { display?: string } | null)?.display ??
      res.statusText;
    throw new Error(`Adzuna error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function salary(job: AdzunaJob): string {
  if (job.salary_min == null && job.salary_max == null) return "";
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  if (job.salary_min != null && job.salary_max != null) {
    return `${fmt(job.salary_min)}–${fmt(job.salary_max)}`;
  }
  return fmt((job.salary_min ?? job.salary_max) as number);
}

export const adzunaAdapter: AdzunaAdapter = {
  provider: "adzuna",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      await get<unknown>(credential, `/jobs/${DEFAULT_COUNTRY}/search/1`, {
        results_per_page: 1,
      });
      return { ok: true, accountLabel: "Adzuna" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchJobs(credential, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const country = (args?.country ?? DEFAULT_COUNTRY).toLowerCase();
    const page = args?.page ?? 1;
    const json = await get<{ count?: number; results?: AdzunaJob[]; mean?: number }>(
      credential,
      `/jobs/${encodeURIComponent(country)}/search/${page}`,
      {
        what: args?.what,
        where: args?.where,
        salary_min: args?.salaryMin,
        results_per_page: limit,
      },
    );
    const jobs = json.results ?? [];
    const lines = [
      "| Title | Company | Location | Salary | Posted | Link |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const j of jobs) {
      lines.push(
        `| ${cell(j.title)} | ${cell(j.company?.display_name)} | ${cell(
          j.location?.display_name,
        )} | ${cell(salary(j))} | ${cell((j.created ?? "").slice(0, 10))} | ${cell(
          j.redirect_url,
        )} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const header =
      json.count != null
        ? `_${json.count.toLocaleString("en-US")} matching jobs${
            json.mean != null ? `, mean salary ${Math.round(json.mean).toLocaleString("en-US")}` : ""
          }._\n\n`
        : "";
    return {
      text: jobs.length ? `${header}${lines.join("\n")}` : "_No jobs found._",
      count: jobs.length,
      truncated: truncated || (json.count ?? 0) > page * limit,
    };
  },

  async salaryHistogram(credential, args) {
    if (!args.what) return { text: "Provide a job title (what) to chart salaries for." };
    const country = (args.country ?? DEFAULT_COUNTRY).toLowerCase();
    const json = await get<{ histogram?: Record<string, number> }>(
      credential,
      `/jobs/${encodeURIComponent(country)}/histogram`,
      { what: args.what, where: args.where },
    );
    const hist = json.histogram ?? {};
    const bands = Object.entries(hist).sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    );
    if (!bands.length) return { text: "_No salary data for that search._" };
    const lines = [`Salary distribution for "${args.what}" (${country}) — jobs per band:`];
    for (const [band, count] of bands) {
      lines.push(`- ${Number(band).toLocaleString("en-US")}: ${count}`);
    }
    return { text: lines.join("\n") };
  },
};
