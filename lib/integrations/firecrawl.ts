import "server-only";
import type { ConnectorAdapter } from "./types";

// Firecrawl (https://firecrawl.dev). Auth is an API key sent as a Bearer
// header. Powers the web_search / web_scrape agent tools and the client
// "import from domain" researcher: discover a site's pages (map) and read a
// page as clean markdown (scrape).
//
// It is BOTH a workspace connector (the `firecrawlAdapter` below — a recruiter
// can paste their own key in Settings) AND a platform fallback (the shared
// FIRECRAWL_API_KEY env var). resolveFirecrawlKey (connector-tokens.ts) prefers
// the workspace key and falls back to env. Each function takes the key
// explicitly to keep it a pure helper.
const API = "https://api.firecrawl.dev/v2";

const MAP_TIMEOUT_MS = 60_000;
const SCRAPE_TIMEOUT_MS = 90_000;
const SEARCH_TIMEOUT_MS = 60_000;
const DEFAULT_MAP_LIMIT = 60;
const DEFAULT_SEARCH_LIMIT = 10;
// One page can be enormous; cap the markdown so a single scrape can't blow the
// agent's context window (mirrors brightdata's CHAR_CAP).
const SCRAPE_CHAR_CAP = 12_000;

async function call<T>(
  apiKey: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { error?: string } | null)?.error ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`Firecrawl error (${res.status}): ${detail}`);
  }
  return json as T;
}

export interface MappedLink {
  url: string;
  title?: string;
}

// The map endpoint has returned links as bare strings (v1) and as objects
// (v2); accept both so a future API tweak doesn't silently empty the list.
type RawLink = string | { url?: string | null; title?: string | null };

/** Discover the URLs on a site. Returns up to `limit` links for the domain. */
export async function firecrawlMap(
  apiKey: string,
  args: { domain: string; search?: string; limit?: number },
): Promise<{ links: MappedLink[] }> {
  const limit = Math.min(args.limit ?? DEFAULT_MAP_LIMIT, 200);
  const json = await call<{ links?: RawLink[] }>(
    apiKey,
    "/map",
    {
      url: `https://${args.domain}`,
      search: args.search || undefined,
      limit,
    },
    MAP_TIMEOUT_MS,
  );
  const links: MappedLink[] = [];
  const seen = new Set<string>();
  for (const raw of json.links ?? []) {
    const url = typeof raw === "string" ? raw : (raw.url ?? "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      url,
      title: typeof raw === "string" ? undefined : (raw.title ?? undefined),
    });
  }
  return { links };
}

/** Scrape one page to markdown. The caller validates the URL host first. */
export async function firecrawlScrape(
  apiKey: string,
  args: { url: string },
): Promise<{ markdown: string; title?: string; truncated: boolean }> {
  const json = await call<{
    data?: {
      markdown?: string | null;
      metadata?: { title?: string | null } | null;
    };
  }>(
    apiKey,
    "/scrape",
    { url: args.url, formats: ["markdown"], onlyMainContent: true },
    SCRAPE_TIMEOUT_MS,
  );
  const full = json.data?.markdown ?? "";
  const truncated = full.length > SCRAPE_CHAR_CAP;
  return {
    markdown: truncated ? `${full.slice(0, SCRAPE_CHAR_CAP)}…` : full,
    title: json.data?.metadata?.title ?? undefined,
    truncated,
  };
}

export interface SearchResult {
  url: string;
  title?: string;
  description?: string;
}

/** Web search. Returns up to `limit` results. Supports Google-style operators
 *  in the query (e.g. `site:github.com ffmpeg`). */
export async function firecrawlSearch(
  apiKey: string,
  args: { query: string; limit?: number },
): Promise<{ results: SearchResult[] }> {
  const limit = Math.min(args.limit ?? DEFAULT_SEARCH_LIMIT, 30);
  // The search endpoint has returned hits either as a flat `data` array or
  // grouped under `data.web` across versions — accept both shapes.
  const json = await call<{
    data?: RawSearchHit[] | { web?: RawSearchHit[] | null } | null;
    web?: RawSearchHit[] | null;
  }>(apiKey, "/search", { query: args.query, limit }, SEARCH_TIMEOUT_MS);

  const raw: RawSearchHit[] = Array.isArray(json.data)
    ? json.data
    : (json.data?.web ?? json.web ?? []);

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const hit of raw) {
    const url = hit?.url ?? "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: hit.title ?? undefined,
      description: hit.description ?? undefined,
    });
  }
  return { results };
}

type RawSearchHit = {
  url?: string | null;
  title?: string | null;
  description?: string | null;
};

// Workspace connector: a recruiter can paste their own Firecrawl key in
// Settings → Connectors instead of relying on the shared platform key. We
// validate the key with a minimal 1-result search (an invalid key returns a
// 401/402 from the API, which firecrawlSearch surfaces as a thrown error).
export const firecrawlAdapter: ConnectorAdapter = {
  provider: "firecrawl",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      await firecrawlSearch(apiKey, { query: "calyflow", limit: 1 });
      return { ok: true, accountLabel: "Firecrawl" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },
};
