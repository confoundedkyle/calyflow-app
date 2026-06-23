import "server-only";
import type { ConnectorAdapter } from "./types";

// Recruit CRM (agency ATS + CRM). Auth is a static API token sent as a Bearer
// token. Reads are candidates (GET /candidates) and jobs (GET /jobs); both
// return a Laravel paginator ({ data: [...], next_page_url, ... }). Field names
// are read tolerantly (snake_case with camelCase fallbacks) since the API mixes
// conventions. validateApiKey lists one page of candidates.
const API = "https://api.recruitcrm.io/v1";

const CHAR_CAP = 12_000;

interface Paginator<T> {
  data?: T[] | null;
  next_page_url?: string | null;
  message?: string | null;
  error?: string | null;
}

interface RcCandidate {
  id?: number | string | null;
  slug?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  firstname?: string | null;
  email?: string | null;
  contact_number?: string | null;
  position?: string | null;
  current_organization?: string | null;
  city?: string | null;
}

interface RcJob {
  id?: number | string | null;
  slug?: string | null;
  name?: string | null;
  job_status?: { label?: string | null } | string | null;
  company?: { company_name?: string | null; name?: string | null } | null;
  city?: string | null;
}

export interface RecruitcrmAdapter extends ConnectorAdapter {
  searchCandidates(
    token: string,
    args?: { search?: string; page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  listJobs(
    token: string,
    args?: { page?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

async function get<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Recruit CRM error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const recruitcrmAdapter: RecruitcrmAdapter = {
  provider: "recruitcrm",
  authType: "apikey",

  async validateApiKey(token) {
    try {
      await get<Paginator<RcCandidate>>(token, "/candidates");
      return { ok: true, accountLabel: "Recruit CRM" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchCandidates(token, args) {
    const json = await get<Paginator<RcCandidate>>(token, "/candidates", {
      page: args?.page,
      search: args?.search,
    });
    const rows = json.data ?? [];
    const lines = [
      "| Name | Email | Phone | Position | ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const c of rows) {
      const name = [c.first_name ?? c.firstname, c.last_name].filter(Boolean).join(" ");
      lines.push(
        `| ${cell(name)} | ${cell(c.email)} | ${cell(c.contact_number)} | ${cell(
          c.position,
        )} | ${cell(c.slug ?? c.id)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.next_page_url;
    return {
      text: rows.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — increment page._" : ""}`
        : "_No candidates._",
      count: rows.length,
      truncated: truncated || more,
    };
  },

  async listJobs(token, args) {
    const json = await get<Paginator<RcJob>>(token, "/jobs", { page: args?.page });
    const rows = json.data ?? [];
    const lines = [
      "| Job | Company | Status | City | ID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const j of rows) {
      const status = typeof j.job_status === "string" ? j.job_status : j.job_status?.label;
      const company = j.company?.company_name ?? j.company?.name;
      lines.push(
        `| ${cell(j.name)} | ${cell(company)} | ${cell(status)} | ${cell(j.city)} | ${cell(
          j.slug ?? j.id,
        )} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.next_page_url;
    return {
      text: rows.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — increment page._" : ""}`
        : "_No jobs._",
      count: rows.length,
      truncated: truncated || more,
    };
  },
};
