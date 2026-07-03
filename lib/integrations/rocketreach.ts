import "server-only";
import type { ConnectorAdapter } from "./types";

// RocketReach. Auth is an API key (RocketReach: Account → API) sent as an
// Api-Key header. Search (POST /person/search) finds profiles by
// name/title/employer/location but returns no contact details and is free;
// Lookup (GET /person/lookup) reveals emails/phones and costs a credit per
// match. Lookups can resolve asynchronously: a "progress"/"searching" status
// means the contact graph is still being crawled — poll /person/checkStatus
// with the profile id (same pattern as Bright Data snapshots).
const API = "https://api.rocketreach.co/api/v2";

const DEFAULT_PAGE_SIZE = 10;
const HARD_PAGE_SIZE = 25;

// Ladder ceilings. RocketReach search (contacts hidden) is FREE, so the budget
// is a call-count guard, not a spend cap.
const HARD_MAX_SEARCHES = 24;
const MAX_TIER_PAGES = 4;
const LADDER_CHAR_CAP = 14_000;

const clampInt = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(n)));
const CHAR_CAP = 12_000;

export interface RocketReachProfile {
  id?: number;
  name?: string | null;
  current_title?: string | null;
  current_employer?: string | null;
  location?: string | null;
  city?: string | null;
  region?: string | null;
  linkedin_url?: string | null;
  status?: string | null;
  emails?:
    | { email?: string | null; smtp_valid?: string | null; type?: string | null }[]
    | null;
  phones?: { number?: string | null; type?: string | null }[] | null;
}

/** One flat RocketReach search (the query fields /person/search accepts). */
export interface RocketReachSearchArgs {
  titles?: string[];
  employers?: string[];
  locations?: string[];
  skills?: string[];
  page?: number;
  limit?: number;
}

/** The search intent the Sourcing agent passes to the ladder. */
export interface RocketReachSourceArgs {
  currentTitles: string[];
  adjacentTitles?: string[];
  skills?: string[];
  keywords?: string;
  companies?: string[];
  location?: string;
  targetCount?: number;
  maxSearches?: number;
}

/** One ladder tier — a single search whose filters these flags choose. RocketReach
 *  takes list filters directly, so no per-title fan-out (like ContactOut). */
export interface RocketReachLadderTier {
  name: string;
  weight: number;
  /** Intent list field → current_title[]. */
  titlesFrom?: string;
  /** Include the intent skills[] (and, with keywordsAsSkills, the keywords). */
  useSkills?: boolean;
  keywordsAsSkills?: boolean;
  /** Include the intent companies → current_employer[]. */
  useCompanies?: boolean;
  useLocation?: boolean;
  /** Result pages to pull (each ≤25). Default 1. */
  pages?: number;
  limit?: number;
}

export interface RocketReachLadderSpec {
  defaults: {
    targetCount: number;
    maxSearches: number;
    limit?: number;
    concurrency?: number;
  };
  tiers: RocketReachLadderTier[];
}

export interface RocketReachAdapter extends ConnectorAdapter {
  searchPeople(
    apiKey: string,
    args: {
      name?: string;
      titles?: string[];
      employers?: string[];
      locations?: string[];
      page?: number;
      limit?: number;
    },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  sourcePeople(
    apiKey: string,
    args: RocketReachSourceArgs,
    spec: RocketReachLadderSpec,
    record?: (searches: number, detail?: unknown) => Promise<void> | void,
  ): Promise<{ text: string; count: number; truncated: boolean; searches: number }>;
  lookupPerson(
    apiKey: string,
    args: {
      name?: string;
      currentEmployer?: string;
      email?: string;
      linkedinUrl?: string;
      profileId?: number;
    },
  ): Promise<{ text: string; found: boolean; pending: boolean }>;
  checkLookup(
    apiKey: string,
    profileId: number,
  ): Promise<{ text: string; found: boolean; pending: boolean }>;
}

function headers(apiKey: string): Record<string, string> {
  return { "Api-Key": apiKey, Accept: "application/json" };
}

function fail(res: Response, json: unknown): never {
  const detail =
    (json as { detail?: string } | null)?.detail ??
    (json as { message?: string } | null)?.message ??
    res.statusText;
  throw new Error(`RocketReach error (${res.status}): ${detail}`);
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function locationOf(p: RocketReachProfile): string {
  return p.location ?? [p.city, p.region].filter(Boolean).join(", ");
}

function isPending(status?: string | null): boolean {
  return status === "searching" || status === "progress" || status === "waiting";
}

function renderProfile(p: RocketReachProfile): { text: string; found: boolean } {
  const header = [
    `**${p.name ?? "Unknown"}**`,
    p.current_title ? `— ${p.current_title}` : "",
    p.current_employer ? `at ${p.current_employer}` : "",
    locationOf(p) ? `· ${locationOf(p)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const emails = (p.emails ?? [])
    .filter((e) => e.email)
    .map(
      (e) =>
        `${e.email}${e.type ? ` (${e.type}${e.smtp_valid ? `, ${e.smtp_valid}` : ""})` : ""}`,
    );
  const phones = (p.phones ?? []).filter((ph) => ph.number).map((ph) => ph.number!);
  const detail = [
    emails.length ? `Emails: ${emails.join(", ")}` : null,
    phones.length ? `Phones: ${phones.join(", ")}` : null,
    p.linkedin_url ? `LinkedIn: ${p.linkedin_url}` : null,
    p.id ? `Profile id: ${p.id}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const found = emails.length + phones.length > 0;
  return {
    text: `${header}\n${detail}${found ? "" : "\n_No contact details returned._"}`,
    found,
  };
}

function renderPendingOrProfile(p: RocketReachProfile): {
  text: string;
  found: boolean;
  pending: boolean;
} {
  if (isPending(p.status)) {
    return {
      text: `Lookup for ${p.name ?? "this person"} is still in progress (profile id ${
        p.id ?? "unknown"
      }). Call rocketreach_check_lookup with that id after working on something else for a moment.`,
      found: false,
      pending: true,
    };
  }
  const rendered = renderProfile(p);
  return { ...rendered, pending: false };
}

/** Low-level /person/search call returning raw profiles + total. Search-only:
 *  no contacts are revealed (that's rocketreach_lookup_person). */
async function rawSearch(
  apiKey: string,
  args: RocketReachSearchArgs,
): Promise<{ profiles: RocketReachProfile[]; total: number }> {
  const query: Record<string, string[]> = {};
  if (args.titles?.length) query.current_title = args.titles;
  if (args.employers?.length) query.current_employer = args.employers;
  if (args.locations?.length) query.location = args.locations;
  if (args.skills?.length) query.skills = args.skills;
  if (Object.keys(query).length === 0) return { profiles: [], total: 0 };
  const pageSize = Math.min(args.limit ?? DEFAULT_PAGE_SIZE, HARD_PAGE_SIZE);
  const start = ((args.page ?? 1) - 1) * pageSize + 1;
  const res = await fetch(`${API}/person/search`, {
    method: "POST",
    headers: { ...headers(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ query, start, page_size: pageSize }),
  });
  const json = (await res.json().catch(() => null)) as {
    profiles?: RocketReachProfile[];
    pagination?: { total?: number };
  } | null;
  if (!res.ok) fail(res, json);
  const profiles = json?.profiles ?? [];
  return { profiles, total: json?.pagination?.total ?? profiles.length };
}

/** Trimmed, non-empty values for an intent field. */
function rrValuesOf(args: RocketReachSourceArgs, key?: string): string[] {
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

/** Expand a tier into its flat searches (one per page). Returns [] when the tier
 *  has no usable filters. Exported for unit tests. */
export function buildRocketReachTierSearches(
  tier: RocketReachLadderTier,
  args: RocketReachSourceArgs,
): RocketReachSearchArgs[] {
  const titles = tier.titlesFrom ? rrValuesOf(args, tier.titlesFrom) : [];
  if (tier.titlesFrom && titles.length === 0) return [];
  const skills = [
    ...(tier.useSkills ? rrValuesOf(args, "skills") : []),
    ...(tier.keywordsAsSkills ? rrValuesOf(args, "keywords") : []),
  ];
  const employers = tier.useCompanies ? rrValuesOf(args, "companies") : [];
  const locations =
    tier.useLocation && args.location?.trim() ? [args.location.trim()] : [];

  const base: RocketReachSearchArgs = {
    titles: titles.length ? titles : undefined,
    employers: employers.length ? employers : undefined,
    locations: locations.length ? locations : undefined,
    skills: skills.length ? skills : undefined,
    limit: tier.limit,
  };
  if (!base.titles && !base.employers && !base.locations && !base.skills) {
    return [];
  }
  const pages = clampInt(tier.pages ?? 1, 1, MAX_TIER_PAGES);
  return Array.from({ length: pages }, (_, i) => ({ ...base, page: i + 1 }));
}

/** Stable key so identical searches across tiers run once. */
function rrSearchKey(s: RocketReachSearchArgs): string {
  return JSON.stringify([
    s.titles ?? [],
    s.employers ?? [],
    s.locations ?? [],
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

/** One markdown table row for a profile (shared by search + ladder). */
function profileRow(p: RocketReachProfile): string {
  return `| ${cell(p.name)} | ${cell(p.current_title)} | ${cell(
    p.current_employer,
  )} | ${cell(locationOf(p))} | ${cell(p.linkedin_url)} | ${p.id ?? ""} |`;
}

const TABLE_HEADER = [
  "| Name | Title | Company | Location | LinkedIn | Profile ID |",
  "| --- | --- | --- | --- | --- | --- |",
];

export const rocketreachAdapter: RocketReachAdapter = {
  provider: "rocketreach",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const res = await fetch(`${API}/account/`, { headers: headers(apiKey) });
      const json = (await res.json().catch(() => null)) as {
        name?: string;
        email?: string;
      } | null;
      if (!res.ok) fail(res, json);
      const label = json?.name ?? json?.email;
      return {
        ok: true,
        accountLabel: label ? `RocketReach (${label})` : "RocketReach",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchPeople(apiKey, args) {
    const query: Record<string, string[]> = {};
    if (args.name) query.name = [args.name];
    if (args.titles?.length) query.current_title = args.titles;
    if (args.employers?.length) query.current_employer = args.employers;
    if (args.locations?.length) query.location = args.locations;
    if (Object.keys(query).length === 0) {
      return {
        text: "Provide at least one search filter: name, titles, employers, or locations.",
        count: 0,
        truncated: false,
      };
    }
    const pageSize = Math.min(args.limit ?? DEFAULT_PAGE_SIZE, HARD_PAGE_SIZE);
    const start = ((args.page ?? 1) - 1) * pageSize + 1;
    const res = await fetch(`${API}/person/search`, {
      method: "POST",
      headers: { ...headers(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ query, start, page_size: pageSize }),
    });
    const json = (await res.json().catch(() => null)) as {
      profiles?: RocketReachProfile[];
      pagination?: { total?: number };
    } | null;
    if (!res.ok) fail(res, json);
    const profiles = json?.profiles ?? [];
    const lines = [
      "| Name | Title | Company | Location | LinkedIn | Profile ID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const p of profiles) {
      lines.push(
        `| ${cell(p.name)} | ${cell(p.current_title)} | ${cell(
          p.current_employer,
        )} | ${cell(locationOf(p))} | ${cell(p.linkedin_url)} | ${p.id ?? ""} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const total = json?.pagination?.total ?? profiles.length;
    return {
      text: profiles.length
        ? `${lines.join("\n")}\n\n_${total} total matches. Search shows no contact details — use rocketreach_lookup_person (costs a credit) on the people you actually need._`
        : "_No profiles found._",
      count: profiles.length,
      truncated: truncated || total > profiles.length,
    };
  },

  async sourcePeople(apiKey, args, spec, record) {
    // Debug: the intent the agent passed, so we can see how it maps to searches.
    console.log(`[rocketreach] ladder intent: ${JSON.stringify(args)}`);
    const target = clampInt(args.targetCount ?? spec.defaults.targetCount, 1, 100);
    const maxSearches = clampInt(
      args.maxSearches ?? spec.defaults.maxSearches,
      1,
      HARD_MAX_SEARCHES,
    );
    const concurrency = clampInt(spec.defaults.concurrency ?? 4, 1, 8);
    const defaultLimit = spec.defaults.limit;

    // linkedin url (or profile id) → first tier that surfaced it + profile.
    const seen = new Map<
      string,
      { tier: string; weight: number; rank: number; profile: RocketReachProfile }
    >();
    const ranQueries = new Set<string>();
    let searchesRun = 0;
    const tierLog: string[] = [];
    let firstError: string | null = null;

    for (const tier of spec.tiers) {
      if (seen.size >= target || searchesRun >= maxSearches) break;
      const searches = buildRocketReachTierSearches(tier, args)
        .map((s) => ({ ...s, limit: s.limit ?? defaultLimit ?? HARD_PAGE_SIZE }))
        .filter((s) => {
          const k = rrSearchKey(s);
          if (ranQueries.has(k)) return false;
          ranQueries.add(k);
          return true;
        });
      if (searches.length === 0) continue;

      const batch = searches.slice(0, maxSearches - searchesRun);
      const batchResults = await mapPool(batch, concurrency, async (s) => {
        try {
          return (await rawSearch(apiKey, s)).profiles;
        } catch (error) {
          if (firstError === null) {
            firstError = error instanceof Error ? error.message : "search failed";
          }
          return [] as RocketReachProfile[];
        }
      });
      searchesRun += batch.length;

      let addedInTier = 0;
      for (const profiles of batchResults) {
        profiles.forEach((p, i) => {
          const key = (p.linkedin_url ?? (p.id != null ? String(p.id) : ""))?.trim();
          if (!key || seen.has(key)) return;
          seen.set(key, { tier: tier.name, weight: tier.weight, rank: i, profile: p });
          addedInTier++;
        });
      }
      tierLog.push(`${tier.name} ${batch.length}q↦+${addedInTier}`);
    }

    if (seen.size === 0 && firstError) {
      return {
        text: `_RocketReach ladder couldn't run (${firstError})._`,
        count: 0,
        truncated: false,
        searches: searchesRun,
      };
    }

    const ranked = [...seen.values()]
      .sort((a, b) => b.weight - a.weight || a.rank - b.rank)
      .slice(0, target);

    if (record && searchesRun > 0) {
      await record(searchesRun, { tiers: tierLog, unique: seen.size });
    }

    const lines = [...TABLE_HEADER];
    let truncated = false;
    for (const { profile } of ranked) {
      lines.push(profileRow(profile));
      if (lines.join("\n").length > LADDER_CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const header =
      `_RocketReach ladder — ${tierLog.join(" · ") || "no tiers run"}. ` +
      `${seen.size} unique across ${searchesRun} free searches (no credits). ` +
      `Search shows no contacts — use rocketreach_lookup_person on the ones you pick._`;
    return {
      text: ranked.length ? `${header}\n\n${lines.join("\n")}` : `${header}\n\n_No profiles found._`,
      count: ranked.length,
      truncated: truncated || seen.size > ranked.length,
      searches: searchesRun,
    };
  },

  async lookupPerson(apiKey, args) {
    const hasAnchor =
      args.profileId ||
      args.email ||
      args.linkedinUrl ||
      (args.name && args.currentEmployer);
    if (!hasAnchor) {
      return {
        text: "Provide a profileId (from search), an email, a LinkedIn URL, or a name plus currentEmployer.",
        found: false,
        pending: false,
      };
    }
    const sp = new URLSearchParams();
    if (args.profileId) sp.set("id", String(args.profileId));
    if (args.name) sp.set("name", args.name);
    if (args.currentEmployer) sp.set("current_employer", args.currentEmployer);
    if (args.email) sp.set("email", args.email);
    if (args.linkedinUrl) sp.set("linkedin_url", args.linkedinUrl);
    const res = await fetch(`${API}/person/lookup?${sp.toString()}`, {
      headers: headers(apiKey),
    });
    const json = (await res.json().catch(() => null)) as RocketReachProfile | null;
    if (res.status === 404) {
      return { text: "No match found for that person.", found: false, pending: false };
    }
    if (!res.ok) fail(res, json);
    if (!json) {
      return { text: "No match found for that person.", found: false, pending: false };
    }
    return renderPendingOrProfile(json);
  },

  async checkLookup(apiKey, profileId) {
    const res = await fetch(
      `${API}/person/checkStatus?ids=${encodeURIComponent(String(profileId))}`,
      { headers: headers(apiKey) },
    );
    const json = (await res.json().catch(() => null)) as
      | RocketReachProfile[]
      | null;
    if (!res.ok) fail(res, json);
    const p = json?.[0];
    if (!p) {
      return {
        text: `No lookup found for profile id ${profileId}.`,
        found: false,
        pending: false,
      };
    }
    return renderPendingOrProfile(p);
  },
};
