import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zendeskSellAdapter } from "@/lib/integrations/zendesk-sell";
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
  it("sends the token as a Bearer header and filters people by is_organization=false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await zendeskSellAdapter.searchPeople("my-token");
    const { url, headers } = requestAt(0);
    expect(url).toBe(
      "https://api.getbase.com/v2/contacts?is_organization=false&per_page=25",
    );
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("throws on a non-2xx response using the error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Unauthorized" } }, 401));
    await expect(zendeskSellAdapter.searchPeople("bad")).rejects.toThrow(
      "Zendesk Sell error (401): Unauthorized",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(zendeskSellAdapter.listDeals("k")).rejects.toThrow(
      /Zendesk Sell error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account from /users/self", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { name: "Rec Ruiter", email: "r@a.com" } }));
    const result = await zendeskSellAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.getbase.com/v2/users/self");
    expect(result).toEqual({ ok: true, accountLabel: "Zendesk Sell (Rec Ruiter)" });
  });

  it("returns the failure message for a rejected token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Unauthorized" } }, 401));
    const result = await zendeskSellAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Zendesk Sell error (401): Unauthorized");
  });
});

describe("searchPeople", () => {
  it("unwraps items[].data and renders the row", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            data: {
              id: 1,
              name: "Ada Lovelace",
              email: "ada@acme.com",
              phone: "+1 555",
              organization_name: "Acme",
              title: "CTO",
            },
          },
        ],
        meta: { count: 1 },
      }),
    );
    const result = await zendeskSellAdapter.searchPeople("k", { name: "ada", limit: 10 });
    expect(requestAt(0).url).toBe(
      "https://api.getbase.com/v2/contacts?is_organization=false&name=ada&per_page=10",
    );
    expect(result.count).toBe(1);
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | +1 555 | Acme | CTO | 1 |");
  });

  it("renders a placeholder when there are no people", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const result = await zendeskSellAdapter.searchPeople("k");
    expect(result.text).toBe("_No people found._");
  });
});

describe("searchCompanies", () => {
  it("filters by is_organization=true and renders website", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ data: { id: 9, name: "Acme", website: "acme.com" } }] }),
    );
    const result = await zendeskSellAdapter.searchCompanies("k");
    expect(requestAt(0).url).toContain("is_organization=true");
    expect(result.text).toContain("| Acme |  |  | acme.com | 9 |");
  });
});

describe("listDeals", () => {
  it("renders deals with value, currency and hot flag", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { data: { id: 5, name: "Acme retainer", value: 12000, currency: "USD", hot: true, organization_name: "Acme" } },
        ],
      }),
    );
    const result = await zendeskSellAdapter.listDeals("k");
    expect(requestAt(0).url).toBe("https://api.getbase.com/v2/deals?per_page=25");
    expect(result.text).toContain("| Acme retainer | 12000 USD | yes | Acme | 5 |");
  });

  it("renders a placeholder when empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const result = await zendeskSellAdapter.listDeals("k");
    expect(result.text).toBe("_No deals found._");
  });
});
