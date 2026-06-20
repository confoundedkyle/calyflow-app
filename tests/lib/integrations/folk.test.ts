import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { folkAdapter } from "@/lib/integrations/folk";
import { jsonResponse, textResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestAt(index: number): {
  url: string;
  headers: Record<string, string>;
} {
  const [url, init] = fetchMock.mock.calls[index];
  return { url, headers: init.headers as Record<string, string> };
}

describe("auth and errors", () => {
  it("sends the key as a Bearer header against the v1 base", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));
    await folkAdapter.listPeople("my-key");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.folk.app/v1/people?limit=25");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Invalid token" }, 401));
    await expect(folkAdapter.listPeople("bad")).rejects.toThrow(
      "folk error (401): Invalid token",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(folkAdapter.listCompanies("k")).rejects.toThrow(
      /folk error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("accepts a key that can list one person", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));
    const result = await folkAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.folk.app/v1/people?limit=1");
    expect(result).toEqual({ ok: true, accountLabel: "folk" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await folkAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("folk error (401): Unauthorized");
  });
});

describe("listPeople", () => {
  it("renders people with the first email/phone and company, and surfaces the next cursor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          items: [
            {
              id: "p1",
              fullName: "Ada Lovelace",
              jobTitle: "CTO",
              emails: ["ada@acme.com"],
              phones: [{ value: "+1 555" }],
              companies: [{ id: "c1", name: "Acme" }],
            },
          ],
          pagination: { nextLink: "https://api.folk.app/v1/people?limit=25&cursor=NEXT123" },
        },
      }),
    );
    const result = await folkAdapter.listPeople("k");
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Ada Lovelace | ada@acme.com | +1 555 | CTO | Acme | p1 |",
    );
    expect(result.text).toContain("pass cursor: NEXT123");
    expect(result.truncated).toBe(true);
  });

  it("passes the cursor and clamps the limit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));
    await folkAdapter.listPeople("k", { cursor: "abc", limit: 999 });
    expect(requestAt(0).url).toBe("https://api.folk.app/v1/people?limit=100&cursor=abc");
  });

  it("renders a placeholder when there are no people", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));
    const result = await folkAdapter.listPeople("k");
    expect(result.text).toBe("_No people found._");
    expect(result.truncated).toBe(false);
  });
});

describe("listCompanies", () => {
  it("renders companies with the first email and website", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          items: [
            { id: "co1", name: "Acme Corp", emails: ["hello@acme.com"], urls: ["https://acme.com"] },
          ],
        },
      }),
    );
    const result = await folkAdapter.listCompanies("k");
    expect(requestAt(0).url).toBe("https://api.folk.app/v1/companies?limit=25");
    expect(result.text).toContain(
      "| Acme Corp | hello@acme.com | https://acme.com | co1 |",
    );
  });

  it("renders a placeholder when empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));
    const result = await folkAdapter.listCompanies("k");
    expect(result.text).toBe("_No companies found._");
  });
});
