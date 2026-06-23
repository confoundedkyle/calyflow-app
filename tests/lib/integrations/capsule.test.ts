import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capsuleAdapter } from "@/lib/integrations/capsule";
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
  it("sends the token as a Bearer header and embeds organisation when browsing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ parties: [] }));
    await capsuleAdapter.searchParties("my-token");
    const { url, headers } = requestAt(0);
    expect(url).toBe(
      "https://api.capsulecrm.com/api/v2/parties?perPage=25&embed=organisation",
    );
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("uses the search endpoint when a query is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ parties: [] }));
    await capsuleAdapter.searchParties("k", { query: "acme" });
    expect(requestAt(0).url).toBe(
      "https://api.capsulecrm.com/api/v2/parties/search?q=acme&perPage=25",
    );
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    await expect(capsuleAdapter.searchParties("bad")).rejects.toThrow(
      "Capsule error (401): Unauthorized",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(capsuleAdapter.listOpportunities("k")).rejects.toThrow(
      /Capsule error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account from /users/me", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: { name: "Rec Ruiter" } }));
    const result = await capsuleAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.capsulecrm.com/api/v2/users/me");
    expect(result).toEqual({ ok: true, accountLabel: "Capsule (Rec Ruiter)" });
  });

  it("returns the failure message for a rejected token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await capsuleAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Capsule error (401): Unauthorized");
  });
});

describe("searchParties", () => {
  it("renders a person with linked company and title, and an organisation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        parties: [
          {
            id: 1,
            type: "person",
            firstName: "Ada",
            lastName: "Lovelace",
            jobTitle: "CTO",
            organisation: { name: "Acme" },
            emailAddresses: [{ address: "ada@acme.com" }],
            phoneNumbers: [{ number: "+1 555" }],
          },
          {
            id: 2,
            type: "organisation",
            name: "Acme Corp",
            emailAddresses: [{ address: "hello@acme.com" }],
          },
        ],
      }),
    );
    const result = await capsuleAdapter.searchParties("k");
    expect(result.count).toBe(2);
    expect(result.text).toContain(
      "| Ada Lovelace | person | ada@acme.com | +1 555 | Acme — CTO | 1 |",
    );
    expect(result.text).toContain("| Acme Corp | organisation | hello@acme.com |  |  | 2 |");
  });

  it("renders a placeholder when there are no parties", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ parties: [] }));
    const result = await capsuleAdapter.searchParties("k");
    expect(result.text).toBe("_No parties found._");
  });
});

describe("listOpportunities", () => {
  it("renders opportunities with value, milestone and party", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        opportunities: [
          {
            id: 5,
            name: "Acme retainer",
            value: { amount: 12000, currency: "USD" },
            milestone: { name: "Proposal" },
            party: { name: "Acme Corp" },
          },
        ],
      }),
    );
    const result = await capsuleAdapter.listOpportunities("k");
    expect(requestAt(0).url).toBe(
      "https://api.capsulecrm.com/api/v2/opportunities?perPage=25&embed=party",
    );
    expect(result.text).toContain("| Acme retainer | 12000 USD | Proposal | Acme Corp | 5 |");
  });

  it("renders a placeholder when empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ opportunities: [] }));
    const result = await capsuleAdapter.listOpportunities("k");
    expect(result.text).toBe("_No opportunities found._");
  });
});
