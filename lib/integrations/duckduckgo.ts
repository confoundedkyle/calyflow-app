import "server-only";

// DuckDuckGo web search (https://duckduckgo.com). Unlike Firecrawl it needs NO
// API key — it reads the keyless HTML endpoint, so it's a free, best-effort web
// search backend. The web_search tool prefers Firecrawl (richer) and falls back
// to this so web search always works with zero setup. May be rate-limited from
// datacenter IPs; it degrades to no results rather than throwing the run.

const ENDPOINT = "https://html.duckduckgo.com/html/";
const TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 10;
const HARD_LIMIT = 30;
// A browser-like UA; the HTML endpoint rejects obvious bots.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface SearchResult {
  url: string;
  title?: string;
  description?: string;
}

/** DuckDuckGo wraps result links as `//duckduckgo.com/l/?uddg=<encoded-url>`.
 *  Unwrap to the real destination; pass through already-direct URLs. */
export function decodeDuckDuckGoHref(href: string): string {
  try {
    const abs = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(abs, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : abs;
  } catch {
    return href;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Parse DuckDuckGo HTML search results into {url, title, description}. Pure (no
 * network) so it's unit-testable. Pairs each result anchor with the snippet that
 * follows it, in document order.
 */
export function parseDuckDuckGoHtml(
  html: string,
  limit = DEFAULT_LIMIT,
): SearchResult[] {
  const linkRe =
    /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe =
    /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html))) snippets.push(stripTags(sm[1]));

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const cap = Math.min(limit, HARD_LIMIT);
  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html)) && results.length < cap) {
    const url = decodeDuckDuckGoHref(lm[1]);
    const idx = i++;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title: stripTags(lm[2]) || undefined,
      description: snippets[idx] || undefined,
    });
  }
  return results;
}

/** Web search via DuckDuckGo's keyless HTML endpoint. Returns up to `limit`
 *  results. Supports Google-style operators in the query (e.g. site:github.com). */
export async function duckduckgoSearch(args: {
  query: string;
  limit?: number;
}): Promise<{ results: SearchResult[] }> {
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
  const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(args.query)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DuckDuckGo error (${res.status})`);
  const html = await res.text();
  return { results: parseDuckDuckGoHtml(html, limit) };
}
