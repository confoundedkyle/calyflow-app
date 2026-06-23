import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stackexchangeAdapter } from "@/lib/integrations/stackexchange";
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
  it("passes the key and search params for users", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await stackexchangeAdapter.searchUsers("my-key", { name: "ada" });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://api.stackexchange.com/2.3/users");
    expect(url.searchParams.get("key")).toBe("my-key");
    expect(url.searchParams.get("site")).toBe("stackoverflow");
    expect(url.searchParams.get("inname")).toBe("ada");
    expect(url.searchParams.get("sort")).toBe("reputation");
  });

  it("throws when the body carries an error_message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error_message: "invalid key" }, 400));
    await expect(
      stackexchangeAdapter.searchUsers("bad", { name: "x" }),
    ).rejects.toThrow("Stack Exchange error (400): invalid key");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      stackexchangeAdapter.searchUsers("k", { name: "x" }),
    ).rejects.toThrow(/Stack Exchange error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with the remaining quota", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{}], quota_remaining: 9800 }));
    const result = await stackexchangeAdapter.validateApiKey!("k");
    expect(urlAt(0).pathname).toBe("/2.3/info");
    expect(result).toEqual({ ok: true, accountLabel: "Stack Exchange (9800 calls left today)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error_message: "key not valid" }, 400));
    const result = await stackexchangeAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("key not valid");
  });
});

describe("searchUsers", () => {
  it("renders users with reputation and profile link", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            user_id: 1,
            display_name: "Ada Lovelace",
            reputation: 54000,
            location: "London, UK",
            link: "https://stackoverflow.com/users/1",
          },
        ],
        has_more: true,
      }),
    );
    const result = await stackexchangeAdapter.searchUsers("k", { name: "ada" });
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Ada Lovelace | 54000 | London, UK | https://stackoverflow.com/users/1 | 1 |",
    );
    expect(result.truncated).toBe(true);
  });

  it("requires a name without calling the API", async () => {
    const result = await stackexchangeAdapter.searchUsers("k", { name: "" });
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("topAnswerers", () => {
  it("queries the tag/period path and renders the answerers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            post_count: 320,
            score: 1500,
            user: { user_id: 2, display_name: "Bo Dev", reputation: 120000, link: "https://stackoverflow.com/users/2" },
          },
        ],
      }),
    );
    const result = await stackexchangeAdapter.topAnswerers("k", { tag: "python", period: "month" });
    expect(urlAt(0).pathname).toBe("/2.3/tags/python/top-answerers/month");
    expect(result.text).toContain(
      "| Bo Dev | 120000 | 320 | 1500 | https://stackoverflow.com/users/2 | 2 |",
    );
  });

  it("defaults the period to all_time", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await stackexchangeAdapter.topAnswerers("k", { tag: "rust" });
    expect(urlAt(0).pathname).toBe("/2.3/tags/rust/top-answerers/all_time");
  });

  it("requires a tag without calling the API", async () => {
    const result = await stackexchangeAdapter.topAnswerers("k", { tag: "" });
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
