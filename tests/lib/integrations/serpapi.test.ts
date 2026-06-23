import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serpapiAdapter } from "@/lib/integrations/serpapi";
import { jsonResponse, textResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function urlAt(index: number): URL {
  return new URL(fetchMock.mock.calls[index][0] as string);
}

describe("auth and errors", () => {
  it("passes the api key, engine, and query as params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ organic_results: [] }));
    await serpapiAdapter.googleSearch("my-key", { query: 'site:linkedin.com/in "React"' });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://serpapi.com/search");
    expect(url.searchParams.get("api_key")).toBe("my-key");
    expect(url.searchParams.get("engine")).toBe("google");
    expect(url.searchParams.get("q")).toBe('site:linkedin.com/in "React"');
    expect(url.searchParams.get("num")).toBe("10");
  });

  it("clamps num to 20", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ organic_results: [] }));
    await serpapiAdapter.googleSearch("k", { query: "x", num: 999 });
    expect(urlAt(0).searchParams.get("num")).toBe("20");
  });

  it("throws when the body reports an error (HTTP 401)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }, 401));
    await expect(
      serpapiAdapter.googleSearch("bad", { query: "x" }),
    ).rejects.toThrow("SerpApi error (401): Invalid API key");
  });

  it("throws when the body reports an error with HTTP 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Your account has run out of searches" }));
    await expect(
      serpapiAdapter.googleSearch("k", { query: "x" }),
    ).rejects.toThrow("SerpApi error: Your account has run out of searches");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(serpapiAdapter.googleSearch("k", { query: "x" })).rejects.toThrow(
      /SerpApi error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account with searches left", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total_searches_left: 4200 }));
    const result = await serpapiAdapter.validateApiKey!("k");
    expect(urlAt(0).pathname).toBe("/account");
    expect(result).toEqual({ ok: true, accountLabel: "SerpApi (4200 searches left)" });
  });

  it("rejects when the body reports an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }, 401));
    const result = await serpapiAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid API key");
  });
});

describe("googleSearch", () => {
  it("renders organic results as a table", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organic_results: [
          { position: 1, title: "Ada Lovelace", link: "https://linkedin.com/in/ada", snippet: "React engineer in Berlin" },
        ],
      }),
    );
    const result = await serpapiAdapter.googleSearch("k", { query: "x" });
    expect(result.count).toBe(1);
    expect(result.text).toContain("| 1 | Ada Lovelace | React engineer in Berlin | https://linkedin.com/in/ada |");
  });

  it("renders a placeholder when there are no results", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ organic_results: [] }));
    const result = await serpapiAdapter.googleSearch("k", { query: "x" });
    expect(result.text).toBe("_No results._");
  });

  it("requires a query", async () => {
    const result = await serpapiAdapter.googleSearch("k", { query: "" });
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
