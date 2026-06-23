import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { affinityAdapter } from "@/lib/integrations/affinity";
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
  it("sends the api key as basic auth with an empty username", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ persons: [] }));
    await affinityAdapter.searchPersons("my-key");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.affinity.co/persons?page_size=25");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(":my-key").toString("base64")}`,
    );
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    await expect(affinityAdapter.searchPersons("bad")).rejects.toThrow(
      "Affinity error (401): Unauthorized",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(affinityAdapter.searchOrganizations("k")).rejects.toThrow(
      /Affinity error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("accepts a key that can list one person", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ persons: [] }));
    const result = await affinityAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.affinity.co/persons?page_size=1");
    expect(result).toEqual({ ok: true, accountLabel: "Affinity" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await affinityAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Affinity error (401): Unauthorized");
  });
});

describe("searchPersons", () => {
  it("renders people with the primary email and passes term + paging, surfacing the next token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        persons: [
          { id: 1, first_name: "Ada", last_name: "Lovelace", primary_email: "ada@acme.com" },
        ],
        next_page_token: "TOK2",
      }),
    );
    const result = await affinityAdapter.searchPersons("k", { query: "ada", limit: 10 });
    expect(requestAt(0).url).toBe(
      "https://api.affinity.co/persons?term=ada&page_size=10",
    );
    expect(result.count).toBe(1);
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | 1 |");
    expect(result.text).toContain("pass pageToken: TOK2");
    expect(result.truncated).toBe(true);
  });

  it("falls back to the first email and clamps the limit", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ persons: [{ id: 2, first_name: "Bo", emails: ["bo@x.com"] }] }),
    );
    const result = await affinityAdapter.searchPersons("k", { limit: 999 });
    expect(requestAt(0).url).toContain("page_size=100");
    expect(result.text).toContain("| Bo | bo@x.com | 2 |");
  });

  it("renders a placeholder when there are no persons", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ persons: [] }));
    const result = await affinityAdapter.searchPersons("k");
    expect(result.text).toBe("_No persons found._");
  });
});

describe("searchOrganizations", () => {
  it("renders organizations with their domain", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ organizations: [{ id: 9, name: "Acme", domain: "acme.com" }] }),
    );
    const result = await affinityAdapter.searchOrganizations("k", { query: "acme" });
    expect(requestAt(0).url).toBe(
      "https://api.affinity.co/organizations?term=acme&page_size=25",
    );
    expect(result.text).toContain("| Acme | acme.com | 9 |");
  });
});

describe("listOpportunities", () => {
  it("renders opportunities by name and id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ opportunities: [{ id: 5, name: "Acme — VP Eng search" }] }),
    );
    const result = await affinityAdapter.listOpportunities("k");
    expect(requestAt(0).url).toBe("https://api.affinity.co/opportunities?page_size=25");
    expect(result.text).toContain("| Acme — VP Eng search | 5 |");
  });

  it("renders a placeholder when empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ opportunities: [] }));
    const result = await affinityAdapter.listOpportunities("k");
    expect(result.text).toBe("_No opportunities found._");
  });
});
