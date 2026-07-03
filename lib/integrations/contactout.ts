import "server-only";
import type { ConnectorAdapter } from "./types";

// ContactOut. Auth is an API key sent in the `token` header (alongside
// `authorization: basic`, per the API docs). Specialty is contact data behind
// LinkedIn profiles: search the profile database (People Search — free unless
// reveal_info is set), get a profile's emails/phones (LinkedIn Enrich), find a
// person without their LinkedIn URL (People Enrich), and verify deliverability
// (Email Verify). Enrichment and reveal_info consume paid credits per person.
const API = "https://api.contactout.com";

const DEFAULT_LIMIT = 10;
const HARD_LIMIT = 25; // ContactOut search pages hold up to 25 profiles
const CHAR_CAP = 12_000;

export interface ContactOutAdapter extends ConnectorAdapter {
  linkedinEnrich(
    apiKey: string,
    args: { profileUrl: string; profileOnly?: boolean },
  ): Promise<{ text: string; found: boolean }>;
  personEnrich(
    apiKey: string,
    args: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      companies?: string[];
      companyDomain?: string;
      jobTitle?: string;
      location?: string;
      linkedinUrl?: string;
      email?: string;
      include?: ("work_email" | "personal_email" | "phone")[];
    },
  ): Promise<{ text: string; found: boolean }>;
  emailVerify(apiKey: string, email: string): Promise<{ text: string }>;
  peopleSearch(
    apiKey: string,
    args: {
      name?: string;
      jobTitles?: string[];
      companies?: string[];
      locations?: string[];
      seniorities?: string[];
      skills?: string[];
      page?: number;
      revealInfo?: boolean;
      limit?: number;
    },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  sourcePeople(
    apiKey: string,
    args: ContactOutSourceArgs,
    spec: ContactOutLadderSpec,
    record?: (searches: number, detail?: unknown) => Promise<void> | void,
  ): Promise<{ text: string; count: number; truncated: boolean; searches: number }>;
}

// --- Ladder types ----------------------------------------------------------
// ContactOut People Search takes LIST filters directly (job_title[], company[],
// location[], seniority[], skills[]) and reveal_info:false makes search FREE —
// so a tier is ONE search that relaxes which filters apply (no per-title fan-out
// like SignalHire). The tier→filter mapping lives in the spec, not here.

/** One flat ContactOut search (the fields peopleSearch accepts). */
export interface ContactOutSearchArgs {
  jobTitles?: string[];
  companies?: string[];
  locations?: string[];
  seniorities?: string[];
  skills?: string[];
  page?: number;
  limit?: number;
}

/** The search intent the Sourcing agent passes to the ladder. */
export interface ContactOutSourceArgs {
  currentTitles: string[];
  adjacentTitles?: string[];
  skills?: string[];
  keywords?: string;
  companies?: string[];
  location?: string;
  seniority?: string;
  targetCount?: number;
  maxSearches?: number;
}

/** One ladder tier — a single search whose filters are chosen by these flags. */
export interface ContactOutLadderTier {
  name: string;
  weight: number;
  /** Intent list field → job_title[]. */
  titlesFrom?: string;
  /** Include the intent skills[] (and, with keywordsAsSkills, the keywords). */
  useSkills?: boolean;
  keywordsAsSkills?: boolean;
  useCompanies?: boolean;
  useLocation?: boolean;
  useSeniority?: boolean;
  /** How many result pages to pull (each ≤25). Default 1. */
  pages?: number;
  limit?: number;
}

export interface ContactOutLadderSpec {
  defaults: {
    targetCount: number;
    maxSearches: number;
    limit?: number;
    concurrency?: number;
  };
  tiers: ContactOutLadderTier[];
}

// Ladder ceilings. ContactOut search (reveal_info:false) is FREE, so the budget
// is a call-count guard, not a spend cap.
const HARD_MAX_SEARCHES = 24;
const MAX_TIER_PAGES = 4;

const clampInt = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(n)));

function headers(apiKey: string): Record<string, string> {
  return { token: apiKey, authorization: "basic", Accept: "application/json" };
}

function fail(res: Response, json: unknown): never {
  const detail =
    (json as { message?: string } | null)?.message ??
    (json as { error?: string } | null)?.error ??
    res.statusText;
  throw new Error(`ContactOut error (${res.status}): ${detail}`);
}

async function get<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "") sp.set(k, v);
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: headers(apiKey),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) fail(res, json);
  return json as T;
}

async function post<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { ...headers(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) fail(res, json);
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

interface ContactOutProfile {
  url?: string | null;
  full_name?: string | null;
  title?: string | null; // search results
  headline?: string | null; // enrich results
  location?: string | null;
  company?: { name?: string | null } | string | null;
  // Enrich responses put contact arrays at the top level of the profile…
  email?: string[] | null;
  work_email?: string[] | null;
  personal_email?: string[] | null;
  phone?: string[] | null;
  // …search responses nest them per profile under contact_info.
  contact_info?: {
    emails?: string[] | null;
    work_emails?: string[] | null;
    personal_emails?: string[] | null;
    phones?: string[] | null;
  } | null;
}

function companyName(p: ContactOutProfile): string {
  if (!p.company) return "";
  return typeof p.company === "string" ? p.company : p.company.name ?? "";
}

function contactsOf(p: ContactOutProfile): {
  work: string[];
  personal: string[];
  other: string[];
  phones: string[];
  any: boolean;
} {
  const c = p.contact_info;
  const work = p.work_email ?? c?.work_emails ?? [];
  const personal = p.personal_email ?? c?.personal_emails ?? [];
  const all = p.email ?? c?.emails ?? [];
  const other = all.filter((e) => !work.includes(e) && !personal.includes(e));
  const phones = p.phone ?? c?.phones ?? [];
  return {
    work,
    personal,
    other,
    phones,
    any: work.length + personal.length + other.length + phones.length > 0,
  };
}

function renderProfile(p: ContactOutProfile, fallbackUrl?: string): string {
  const header = [
    `**${p.full_name ?? "Unknown"}**`,
    p.headline ?? p.title ? `— ${p.headline ?? p.title}` : "",
    companyName(p) ? `at ${companyName(p)}` : "",
    p.location ? `· ${p.location}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const c = contactsOf(p);
  const url = p.url ?? fallbackUrl;
  const detail = [
    c.work.length ? `Work emails: ${c.work.join(", ")}` : null,
    c.personal.length ? `Personal emails: ${c.personal.join(", ")}` : null,
    c.other.length ? `Other emails: ${c.other.join(", ")}` : null,
    c.phones.length ? `Phones: ${c.phones.join(", ")}` : null,
    url ? `LinkedIn: ${url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  if (!c.any) {
    return `${header}\n${detail ? `${detail}\n` : ""}_No contact details returned._`;
  }
  return `${header}\n${detail}`;
}

function renderSearch(entries: [string, ContactOutProfile][]): {
  text: string;
  truncated: boolean;
} {
  if (entries.length === 0)
    return { text: "_No profiles found._", truncated: false };
  const lines = [
    "| Name | Title | Company | Location | LinkedIn | Contacts |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  let truncated = false;
  for (const [url, p] of entries) {
    const c = contactsOf(p);
    const contacts = [
      c.work.length ? `work: ${c.work.join("; ")}` : null,
      c.personal.length ? `personal: ${c.personal.join("; ")}` : null,
      c.other.length ? `email: ${c.other.join("; ")}` : null,
      c.phones.length ? `phone: ${c.phones.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      `| ${cell(p.full_name)} | ${cell(p.title ?? p.headline)} | ${cell(
        companyName(p),
      )} | ${cell(p.location)} | ${cell(p.url ?? url)} | ${cell(contacts)} |`,
    );
    if (lines.join("\n").length > CHAR_CAP) {
      truncated = true;
      break;
    }
  }
  return { text: lines.join("\n"), truncated };
}

/** Low-level people/search call returning raw [url, profile] entries + total.
 *  Shared by peopleSearch (renders a table) and the ladder (dedupes across
 *  tiers). Always search-only: reveal_info stays false. */
async function rawPeopleSearch(
  apiKey: string,
  args: ContactOutSearchArgs,
): Promise<{ entries: [string, ContactOutProfile][]; total: number }> {
  const body: Record<string, unknown> = {
    page: args.page ?? 1,
    reveal_info: false,
  };
  if (args.jobTitles?.length) body.job_title = args.jobTitles;
  if (args.companies?.length) body.company = args.companies;
  if (args.locations?.length) body.location = args.locations;
  if (args.seniorities?.length) body.seniority = args.seniorities;
  if (args.skills?.length) body.skills = args.skills;
  if (
    !body.job_title &&
    !body.company &&
    !body.location &&
    !body.seniority &&
    !body.skills
  ) {
    return { entries: [], total: 0 };
  }
  const json = await post<{
    metadata?: { total_results?: number };
    profiles?: Record<string, ContactOutProfile>;
  }>(apiKey, "/v1/people/search", body);
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
  const entries = Object.entries(json.profiles ?? {}).slice(0, limit);
  return { entries, total: json.metadata?.total_results ?? entries.length };
}

/** Trimmed, non-empty values for an intent field. */
function coValuesOf(args: ContactOutSourceArgs, key?: string): string[] {
  if (!key) return [];
  const raw = (args as unknown as Record<string, unknown>)[key];
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(raw)) {
    return raw.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  }
  return [];
}

/** Expand a tier into the flat searches it should run (one per page). Returns []
 *  when the tier has no usable filters. Exported for unit tests. */
export function buildContactOutTierSearches(
  tier: ContactOutLadderTier,
  args: ContactOutSourceArgs,
): ContactOutSearchArgs[] {
  const jobTitles = tier.titlesFrom ? coValuesOf(args, tier.titlesFrom) : [];
  if (tier.titlesFrom && jobTitles.length === 0) return []; // declared but empty
  const skills = [
    ...(tier.useSkills ? coValuesOf(args, "skills") : []),
    ...(tier.keywordsAsSkills ? coValuesOf(args, "keywords") : []),
  ];
  const companies = tier.useCompanies ? coValuesOf(args, "companies") : [];
  const locations =
    tier.useLocation && args.location?.trim() ? [args.location.trim()] : [];
  const seniorities =
    tier.useSeniority && args.seniority?.trim() ? [args.seniority.trim()] : [];

  const base: ContactOutSearchArgs = {
    jobTitles: jobTitles.length ? jobTitles : undefined,
    companies: companies.length ? companies : undefined,
    locations: locations.length ? locations : undefined,
    seniorities: seniorities.length ? seniorities : undefined,
    skills: skills.length ? skills : undefined,
    limit: tier.limit,
  };
  // No usable filter → skip (never search everything).
  if (
    !base.jobTitles &&
    !base.companies &&
    !base.locations &&
    !base.seniorities &&
    !base.skills
  ) {
    return [];
  }
  const pages = clampInt(tier.pages ?? 1, 1, MAX_TIER_PAGES);
  return Array.from({ length: pages }, (_, i) => ({ ...base, page: i + 1 }));
}

/** Stable key so identical searches across tiers run once. */
function coSearchKey(s: ContactOutSearchArgs): string {
  return JSON.stringify([
    s.jobTitles ?? [],
    s.companies ?? [],
    s.locations ?? [],
    s.seniorities ?? [],
    s.skills ?? [],
    s.page ?? 1,
  ]).toLowerCase();
}

/** Bounded-concurrency map, preserving input order. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export const contactoutAdapter: ContactOutAdapter = {
  provider: "contactout",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      // Usage stats are free to read — period defaults to the current month.
      await get<{ status_code?: number }>(apiKey, "/v1/stats", {});
      return { ok: true, accountLabel: "ContactOut account" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async linkedinEnrich(apiKey, args) {
    if (!args.profileUrl) {
      return { text: "Provide a LinkedIn profile URL.", found: false };
    }
    const json = await get<{ profile?: ContactOutProfile | null }>(
      apiKey,
      "/v1/linkedin/enrich",
      {
        profile: args.profileUrl,
        profile_only: args.profileOnly ? "true" : undefined,
      },
    );
    const p = json.profile;
    if (!p) return { text: "No profile found for that URL.", found: false };
    return {
      text: renderProfile(p, args.profileUrl),
      found: args.profileOnly ? true : contactsOf(p).any,
    };
  },

  async personEnrich(apiKey, args) {
    const hasName =
      args.fullName || (args.firstName && args.lastName);
    if (!hasName && !args.linkedinUrl && !args.email) {
      return {
        text: "Provide the person's name (fullName, or firstName + lastName), or a LinkedIn URL or known email.",
        found: false,
      };
    }
    const hasAnchor =
      args.companies?.length ||
      args.companyDomain ||
      args.jobTitle ||
      args.location ||
      args.linkedinUrl ||
      args.email;
    if (!hasAnchor) {
      return {
        text: "Provide at least one anchor besides the name: companies, companyDomain, jobTitle, location, linkedinUrl, or email.",
        found: false,
      };
    }
    const body: Record<string, unknown> = {
      include: args.include ?? ["work_email", "personal_email", "phone"],
    };
    if (args.fullName) body.full_name = args.fullName;
    if (args.firstName) body.first_name = args.firstName;
    if (args.lastName) body.last_name = args.lastName;
    if (args.companies?.length) body.company = args.companies;
    if (args.companyDomain) body.company_domain = args.companyDomain;
    if (args.jobTitle) body.job_title = args.jobTitle;
    if (args.location) body.location = args.location;
    if (args.linkedinUrl) body.linkedin_url = args.linkedinUrl;
    if (args.email) body.email = args.email;

    const json = await post<{ profile?: ContactOutProfile | null }>(
      apiKey,
      "/v1/people/enrich",
      body,
    );
    const p = json.profile;
    if (!p) return { text: "No match found for that person.", found: false };
    return { text: renderProfile(p), found: contactsOf(p).any };
  },

  async emailVerify(apiKey, email) {
    const json = await get<{ data?: { status?: string } }>(
      apiKey,
      "/v1/email/verify",
      { email },
    );
    return { text: `${email}: ${json.data?.status ?? "unknown"}` };
  },

  async peopleSearch(apiKey, args) {
    if (
      !args.name &&
      !args.jobTitles?.length &&
      !args.companies?.length &&
      !args.locations?.length &&
      !args.seniorities?.length &&
      !args.skills?.length
    ) {
      return {
        text: "Provide at least one search filter: name, jobTitles, companies, locations, seniorities, or skills.",
        count: 0,
        truncated: false,
      };
    }
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const body: Record<string, unknown> = {
      page: args.page ?? 1,
      reveal_info: args.revealInfo ?? false,
    };
    if (args.name) body.name = args.name;
    if (args.jobTitles?.length) body.job_title = args.jobTitles;
    if (args.companies?.length) body.company = args.companies;
    if (args.locations?.length) body.location = args.locations;
    if (args.seniorities?.length) body.seniority = args.seniorities;
    if (args.skills?.length) body.skills = args.skills;

    const json = await post<{
      metadata?: { page?: number; total_results?: number };
      profiles?: Record<string, ContactOutProfile>;
    }>(apiKey, "/v1/people/search", body);
    const entries = Object.entries(json.profiles ?? {}).slice(0, limit);
    const total = json.metadata?.total_results ?? entries.length;
    const rendered = renderSearch(entries);
    const page = json.metadata?.page ?? args.page ?? 1;
    return {
      text: entries.length
        ? `${rendered.text}\n\n_Page ${page} — ${total} total matches._`
        : rendered.text,
      count: entries.length,
      truncated: rendered.truncated || total > entries.length,
    };
  },

  async sourcePeople(apiKey, args, spec, record) {
    // Debug: the intent the agent passed, so we can see how it maps to searches.
    console.log(`[contactout] ladder intent: ${JSON.stringify(args)}`);
    const target = clampInt(args.targetCount ?? spec.defaults.targetCount, 1, 100);
    const maxSearches = clampInt(
      args.maxSearches ?? spec.defaults.maxSearches,
      1,
      HARD_MAX_SEARCHES,
    );
    const concurrency = clampInt(spec.defaults.concurrency ?? 4, 1, 8);
    const defaultLimit = spec.defaults.limit;

    // url → first tier that surfaced the profile (for weight-ranking) + profile.
    const seen = new Map<
      string,
      { tier: string; weight: number; rank: number; profile: ContactOutProfile }
    >();
    const ranQueries = new Set<string>();
    let searchesRun = 0;
    const tierLog: string[] = [];
    let firstError: string | null = null;

    for (const tier of spec.tiers) {
      if (seen.size >= target || searchesRun >= maxSearches) break;
      const searches = buildContactOutTierSearches(tier, args)
        .map((s) => ({ ...s, limit: s.limit ?? defaultLimit ?? HARD_LIMIT }))
        .filter((s) => {
          const k = coSearchKey(s);
          if (ranQueries.has(k)) return false;
          ranQueries.add(k);
          return true;
        });
      if (searches.length === 0) continue;

      const batch = searches.slice(0, maxSearches - searchesRun);
      const batchResults = await mapPool(batch, concurrency, async (s) => {
        try {
          return (await rawPeopleSearch(apiKey, s)).entries;
        } catch (error) {
          if (firstError === null) {
            firstError = error instanceof Error ? error.message : "search failed";
          }
          return [] as [string, ContactOutProfile][];
        }
      });
      searchesRun += batch.length;

      let addedInTier = 0;
      for (const entries of batchResults) {
        entries.forEach(([key, profile], i) => {
          const url = (profile.url ?? key)?.trim();
          if (!url || seen.has(url)) return;
          seen.set(url, { tier: tier.name, weight: tier.weight, rank: i, profile });
          addedInTier++;
        });
      }
      tierLog.push(`${tier.name} ${batch.length}q↦+${addedInTier}`);
    }

    if (seen.size === 0 && firstError) {
      return {
        text: `_ContactOut ladder couldn't run (${firstError})._`,
        count: 0,
        truncated: false,
        searches: searchesRun,
      };
    }

    const ranked = [...seen.entries()]
      .sort((a, b) => b[1].weight - a[1].weight || a[1].rank - b[1].rank)
      .slice(0, target);

    if (record && searchesRun > 0) {
      // Search (reveal_info:false) is free — record 0 spend, log calls + yield.
      await record(searchesRun, { tiers: tierLog, unique: seen.size });
    }

    const rendered = renderSearch(
      ranked.map(([url, s]) => [url, s.profile] as [string, ContactOutProfile]),
    );
    const header =
      `_ContactOut ladder — ${tierLog.join(" · ") || "no tiers run"}. ` +
      `${seen.size} unique across ${searchesRun} free searches (no credits). ` +
      `Search is contact-free — reveal emails later with the enrichment step._`;
    return {
      text: ranked.length ? `${header}\n\n${rendered.text}` : `${header}\n\n_No profiles found._`,
      count: ranked.length,
      truncated: rendered.truncated || seen.size > ranked.length,
      searches: searchesRun,
    };
  },
};
