import "server-only";
import type { ConnectorAdapter } from "./types";

// SerpApi (Google Search results). Auth is an API key passed as the `api_key`
// query param. The single read runs a Google search (GET /search) and renders
// the organic results — useful for X-ray sourcing (e.g. site:linkedin.com/in
// "React" "Berlin"). SerpApi reports key/quota problems with a top-level `error`
// field, so the request helper checks it. validateApiKey reads /account and
// labels the connection with the remaining searches.
const API = "https://serpapi.com";

const DEFAULT_NUM = 10;
const HARD_NUM = 20;
const CHAR_CAP = 12_000;

interface OrganicResult {
  position?: number | null;
  title?: string | null;
  link?: string | null;
  snippet?: string | null;
}
interface SerpResponse {
  organic_results?: OrganicResult[] | null;
  error?: string | null;
  total_searches_left?: number | null;
  searches_left?: number | null;
}

export interface SerpapiAdapter extends ConnectorAdapter {
  googleSearch(
    apiKey: string,
    args: { query: string; num?: number; start?: number },
  ): Promise<{ text: string; count: number }>;
}

async function get(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<SerpResponse> {
  const sp = new URLSearchParams();
  sp.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, v);
  const res = await fetch(`${API}${path}?${sp.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as SerpResponse | null;
  if (!res.ok) {
    throw new Error(`SerpApi error (${res.status}): ${json?.error ?? res.statusText}`);
  }
  if (json?.error) {
    throw new Error(`SerpApi error: ${json.error}`);
  }
  return json ?? {};
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const serpapiAdapter: SerpapiAdapter = {
  provider: "serpapi",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const json = await get(apiKey, "/account");
      const left = json.total_searches_left ?? json.searches_left;
      return {
        ok: true,
        accountLabel:
          typeof left === "number" ? `SerpApi (${left} searches left)` : "SerpApi",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async googleSearch(apiKey, args) {
    if (!args.query) return { text: "Provide a search query.", count: 0 };
    const num = Math.min(args.num ?? DEFAULT_NUM, HARD_NUM);
    const json = await get(apiKey, "/search", {
      engine: "google",
      q: args.query,
      num: String(num),
      start: args.start !== undefined ? String(args.start) : undefined,
    });
    const results = json.organic_results ?? [];
    const lines = ["| # | Title | Snippet | Link |", "| --- | --- | --- | --- |"];
    for (const r of results) {
      const snippet = r.snippet ? cell(r.snippet).slice(0, 160) : "";
      lines.push(`| ${r.position ?? ""} | ${cell(r.title)} | ${snippet} | ${cell(r.link)} |`);
      if (lines.join("\n").length > CHAR_CAP) break;
    }
    return {
      text: results.length ? lines.join("\n") : "_No results._",
      count: results.length,
    };
  },
};
