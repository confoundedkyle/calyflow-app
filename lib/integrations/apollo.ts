import "server-only";
import type { ConnectorAdapter } from "./types";

// Apollo.io. Auth is an API key sent in the `X-Api-Key` header. The operational
// endpoints are POST-only with JSON bodies. Used for business development:
// discover decision-makers at target companies (People Search), reveal a known
// person's work email/phone (People Match / enrich), and find target companies
// (Organization Search). Note: People Search returns people with emails masked —
// the agent must enrich a person to obtain an actual address.
const API = "https://api.apollo.io";

const DEFAULT_LIMIT = 10;
const HARD_LIMIT = 100;
const HARD_MAX_SEARCHES = 24;
const MAX_TIER_PAGES = 4;
const LADDER_CHAR_CAP = 14_000;
const CHAR_CAP = 12_000;

const clampInt = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(n)));

export interface ApolloAdapter extends ConnectorAdapter {
  searchPeople(
    apiKey: string,
    args: {
      domain?: string;
      company?: string;
      titles?: string[];
      seniorities?: string[];
      locations?: string[];
      page?: number;
      limit?: number;
    },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  sourcePeople(
    apiKey: string,
    args: ApolloSourceArgs,
    spec: ApolloLadderSpec,
    record?: (searches: number, detail?: unknown) => Promise<void> | void,
  ): Promise<{ text: string; count: number; truncated: boolean; searches: number }>;
  enrichPerson(
    apiKey: string,
    args: {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      company?: string;
      domain?: string;
      revealEmail?: boolean;
    },
  ): Promise<{ text: string; found: boolean }>;
  searchOrganizations(
    apiKey: string,
    args: {
      keywords?: string;
      locations?: string[];
      employeeRanges?: string[];
      limit?: number;
    },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
}

async function post<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { error?: string; message?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`Apollo error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

interface ApolloOrganization {
  name?: string | null;
  primary_domain?: string | null;
  website_url?: string | null;
}

interface ApolloPerson {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone_numbers?: { raw_number?: string | null }[] | null;
  organization?: ApolloOrganization | null;
}

export interface ApolloSearchArgs {
  domain?: string;
  company?: string;
  titles?: string[];
  seniorities?: string[];
  locations?: string[];
  page?: number;
  limit?: number;
}

export interface ApolloSourceArgs {
  currentTitles: string[];
  adjacentTitles?: string[];
  companies?: string[];
  domain?: string;
  location?: string;
  seniorities?: string[];
  targetCount?: number;
  maxSearches?: number;
}

export interface ApolloLadderTier {
  name: string;
  weight: number;
  titlesFrom?: string;
  useCompanies?: boolean;
  useDomain?: boolean;
  useLocation?: boolean;
  useSeniorities?: boolean;
  pages?: number;
  limit?: number;
}

export interface ApolloLadderSpec {
  defaults: {
    targetCount: number;
    maxSearches: number;
    limit?: number;
    concurrency?: number;
  };
  tiers: ApolloLadderTier[];
}

interface ApolloCompany {
  name?: string | null;
  primary_domain?: string | null;
  website_url?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

function nameOf(p: ApolloPerson): string {
  return p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
}

function locationOf(p: ApolloPerson | ApolloCompany): string {
  return [p.city, p.state, p.country].filter(Boolean).join(", ");
}

function domainOf(o: ApolloOrganization | ApolloCompany | null | undefined): string {
  if (!o) return "";
  return o.primary_domain ?? o.website_url ?? "";
}

function renderPeople(people: ApolloPerson[]): { text: string; truncated: boolean } {
  if (people.length === 0) return { text: "_No contacts found._", truncated: false };
  const lines = [
    "| Name | Title | Company | Location | Email | Email status |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  let truncated = false;
  for (const p of people) {
    lines.push(
      `| ${cell(nameOf(p))} | ${cell(p.title)} | ${cell(
        p.organization?.name,
      )} | ${cell(locationOf(p))} | ${cell(p.email)} | ${cell(p.email_status)} |`,
    );
    if (lines.join("\n").length > CHAR_CAP) {
      truncated = true;
      break;
    }
  }
  return { text: lines.join("\n"), truncated };
}

async function rawPeopleSearch(
  apiKey: string,
  args: ApolloSearchArgs,
): Promise<{ people: ApolloPerson[]; total: number }> {
  if (!args.domain && !args.company && !args.titles?.length) {
    return { people: [], total: 0 };
  }
  const perPage = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
  const body: Record<string, unknown> = {
    page: args.page ?? 1,
    per_page: perPage,
  };
  if (args.domain) body.q_organization_domains = args.domain;
  if (args.company) body.q_organization_name = args.company;
  if (args.titles?.length) body.person_titles = args.titles;
  if (args.seniorities?.length) body.person_seniorities = args.seniorities;
  if (args.locations?.length) body.person_locations = args.locations;

  const json = await post<{
    people?: ApolloPerson[];
    pagination?: { total_entries?: number };
  }>(apiKey, "/api/v1/mixed_people/search", body);
  const people = json.people ?? [];
  return {
    people,
    total: json.pagination?.total_entries ?? people.length,
  };
}

function apolloValuesOf(args: ApolloSourceArgs, key?: string): string[] {
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

export function buildApolloTierSearches(
  tier: ApolloLadderTier,
  args: ApolloSourceArgs,
): ApolloSearchArgs[] {
  const titles = tier.titlesFrom ? apolloValuesOf(args, tier.titlesFrom) : [];
  if (tier.titlesFrom && titles.length === 0) return [];
  const companies = tier.useCompanies ? apolloValuesOf(args, "companies") : [];
  const domain = tier.useDomain ? args.domain?.trim() : undefined;
  const locations =
    tier.useLocation && args.location?.trim() ? [args.location.trim()] : [];
  const seniorities = tier.useSeniorities ? apolloValuesOf(args, "seniorities") : [];

  const bases: ApolloSearchArgs[] = [];
  const companyTargets = companies.length ? companies : [undefined];
  for (const company of companyTargets) {
    const base: ApolloSearchArgs = {
      domain: domain || undefined,
      company,
      titles: titles.length ? titles : undefined,
      seniorities: seniorities.length ? seniorities : undefined,
      locations: locations.length ? locations : undefined,
      limit: tier.limit,
    };
    if (!base.domain && !base.company && !base.titles) continue;
    const pages = clampInt(tier.pages ?? 1, 1, MAX_TIER_PAGES);
    for (let page = 1; page <= pages; page++) bases.push({ ...base, page });
  }
  return bases;
}

function apolloSearchKey(s: ApolloSearchArgs): string {
  return JSON.stringify([
    s.domain ?? "",
    s.company ?? "",
    s.titles ?? [],
    s.seniorities ?? [],
    s.locations ?? [],
    s.page ?? 1,
  ]).toLowerCase();
}

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

function personKey(p: ApolloPerson): string {
  const linkedin = p.linkedin_url?.trim();
  if (linkedin) return linkedin.toLowerCase();
  const name = nameOf(p).trim().toLowerCase();
  const company = p.organization?.name?.trim().toLowerCase() ?? "";
  const title = p.title?.trim().toLowerCase() ?? "";
  return [name, company, title].filter(Boolean).join("|");
}

function peopleRow(p: ApolloPerson): string {
  return `| ${cell(nameOf(p))} | ${cell(p.title)} | ${cell(
    p.organization?.name,
  )} | ${cell(locationOf(p))} | ${cell(p.email)} | ${cell(
    p.email_status,
  )} | ${cell(p.linkedin_url)} |`;
}

const PEOPLE_TABLE_HEADER = [
  "| Name | Title | Company | Location | Email | Email status | LinkedIn |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];

function renderOrganizations(orgs: ApolloCompany[]): {
  text: string;
  truncated: boolean;
} {
  if (orgs.length === 0) return { text: "_No companies found._", truncated: false };
  const lines = [
    "| Company | Domain | Industry | Employees | Location |",
    "| --- | --- | --- | --- | --- |",
  ];
  let truncated = false;
  for (const o of orgs) {
    lines.push(
      `| ${cell(o.name)} | ${cell(domainOf(o))} | ${cell(o.industry)} | ${
        o.estimated_num_employees ?? ""
      } | ${cell(locationOf(o))} |`,
    );
    if (lines.join("\n").length > CHAR_CAP) {
      truncated = true;
      break;
    }
  }
  return { text: lines.join("\n"), truncated };
}

export const apolloAdapter: ApolloAdapter = {
  provider: "apollo",
  authType: "apikey",

  async validateApiKey(apiKey) {
    // The auth-health check is a GET (Apollo's operational endpoints are POST,
    // but this one isn't — POSTing to it returns 404). Send the key both as the
    // X-Api-Key header and the api_key query param to cover both key styles.
    try {
      const res = await fetch(
        `${API}/v1/auth/health?api_key=${encodeURIComponent(apiKey)}`,
        { headers: { "X-Api-Key": apiKey, Accept: "application/json" } },
      );
      const json = (await res.json().catch(() => null)) as {
        is_logged_in?: boolean;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { ok: false, message: "Apollo rejected the API key." };
        }
        const detail = json?.error ?? json?.message ?? res.statusText;
        return { ok: false, message: `Apollo error (${res.status}): ${detail}` };
      }
      if (json?.is_logged_in === false) {
        return { ok: false, message: "Apollo rejected the API key." };
      }
      return { ok: true, accountLabel: "Apollo account" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async searchPeople(apiKey, args) {
    if (!args.domain && !args.company && !args.titles?.length) {
      return {
        text: "Provide a domain, company name, or at least one title to search.",
        count: 0,
        truncated: false,
      };
    }
    const { people, total } = await rawPeopleSearch(apiKey, args);
    const rendered = renderPeople(people);
    return {
      text: rendered.text,
      count: people.length,
      truncated: rendered.truncated || total > people.length,
    };
  },

  async sourcePeople(apiKey, args, spec, record) {
    console.log(`[apollo] ladder intent: ${JSON.stringify(args)}`);
    const target = clampInt(args.targetCount ?? spec.defaults.targetCount, 1, 100);
    const maxSearches = clampInt(
      args.maxSearches ?? spec.defaults.maxSearches,
      1,
      HARD_MAX_SEARCHES,
    );
    const concurrency = clampInt(spec.defaults.concurrency ?? 4, 1, 8);
    const defaultLimit = spec.defaults.limit;
    const seen = new Map<
      string,
      { tier: string; weight: number; rank: number; person: ApolloPerson }
    >();
    const ranQueries = new Set<string>();
    let searchesRun = 0;
    const tierLog: string[] = [];
    let firstError: string | null = null;

    for (const tier of spec.tiers) {
      if (seen.size >= target || searchesRun >= maxSearches) break;
      const searches = buildApolloTierSearches(tier, args)
        .map((s) => ({ ...s, limit: s.limit ?? defaultLimit ?? HARD_LIMIT }))
        .filter((s) => {
          const k = apolloSearchKey(s);
          if (ranQueries.has(k)) return false;
          ranQueries.add(k);
          return true;
        });
      if (searches.length === 0) continue;

      const batch = searches.slice(0, maxSearches - searchesRun);
      const batchResults = await mapPool(batch, concurrency, async (s) => {
        try {
          return (await rawPeopleSearch(apiKey, s)).people;
        } catch (error) {
          if (firstError === null) {
            firstError = error instanceof Error ? error.message : "search failed";
          }
          return [] as ApolloPerson[];
        }
      });
      searchesRun += batch.length;

      let addedInTier = 0;
      for (const people of batchResults) {
        people.forEach((person, i) => {
          const key = personKey(person);
          if (!key || seen.has(key)) return;
          seen.set(key, { tier: tier.name, weight: tier.weight, rank: i, person });
          addedInTier++;
        });
      }
      tierLog.push(`${tier.name} ${batch.length}q->+${addedInTier}`);
    }

    if (seen.size === 0 && firstError) {
      return {
        text: `_Apollo ladder couldn't run (${firstError})._`,
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

    const lines = [...PEOPLE_TABLE_HEADER];
    let truncated = false;
    for (const { person } of ranked) {
      lines.push(peopleRow(person));
      if (lines.join("\n").length > LADDER_CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const header =
      `_Apollo ladder — ${tierLog.join(" · ") || "no tiers run"}. ` +
      `${seen.size} unique across ${searchesRun} searches. ` +
      `Search may mask emails — use apollo_enrich_person only on the people you pick._`;
    return {
      text: ranked.length ? `${header}\n\n${lines.join("\n")}` : `${header}\n\n_No contacts found._`,
      count: ranked.length,
      truncated: truncated || seen.size > ranked.length,
      searches: searchesRun,
    };
  },

  async enrichPerson(apiKey, args) {
    if (!args.fullName && !args.firstName && !args.lastName) {
      return { text: "Provide the person's name to enrich.", found: false };
    }
    if (!args.domain && !args.company) {
      return { text: "Provide a company domain or name to enrich.", found: false };
    }
    const body: Record<string, unknown> = {
      reveal_personal_emails: args.revealEmail ?? false,
    };
    if (args.fullName) body.name = args.fullName;
    if (args.firstName) body.first_name = args.firstName;
    if (args.lastName) body.last_name = args.lastName;
    if (args.company) body.organization_name = args.company;
    if (args.domain) body.domain = args.domain;

    const json = await post<{ person?: ApolloPerson | null }>(
      apiKey,
      "/api/v1/people/match",
      body,
    );
    const p = json.person;
    if (!p) return { text: "No match found for that person.", found: false };

    const phone = p.phone_numbers?.find((n) => n.raw_number)?.raw_number ?? "";
    const parts = [
      `**${nameOf(p) || "Unknown"}**`,
      p.title ? `— ${p.title}` : "",
      p.organization?.name ? `at ${p.organization.name}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const detail = [
      p.email ? `Email: ${p.email}${p.email_status ? ` (${p.email_status})` : ""}` : null,
      phone ? `Phone: ${phone}` : null,
      p.linkedin_url ? `LinkedIn: ${p.linkedin_url}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      text: detail ? `${parts}\n${detail}` : `${parts}\n_No contact details returned._`,
      found: !!(p.email || phone),
    };
  },

  async searchOrganizations(apiKey, args) {
    if (!args.keywords && !args.locations?.length && !args.employeeRanges?.length) {
      return {
        text: "Provide keywords, a location, or an employee-size range to search.",
        count: 0,
        truncated: false,
      };
    }
    const perPage = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const body: Record<string, unknown> = { page: 1, per_page: perPage };
    if (args.keywords) body.q_organization_keyword_tags = args.keywords;
    if (args.locations?.length) body.organization_locations = args.locations;
    if (args.employeeRanges?.length)
      body.organization_num_employees_ranges = args.employeeRanges;

    const json = await post<{
      organizations?: ApolloCompany[];
      pagination?: { total_entries?: number };
    }>(apiKey, "/api/v1/mixed_companies/search", body);
    const orgs = json.organizations ?? [];
    const total = json.pagination?.total_entries ?? orgs.length;
    const rendered = renderOrganizations(orgs);
    return {
      text: rendered.text,
      count: orgs.length,
      truncated: rendered.truncated || total > orgs.length,
    };
  },
};
