import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesflareAdapter } from "@/lib/integrations/salesflare";
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
  it("sends the key as a Bearer header to the root contacts path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await salesflareAdapter.searchContacts("my-key", { name: "ada" });
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.salesflare.com/contacts?name=ada&limit=25");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the error field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Forbidden" }, 401));
    await expect(salesflareAdapter.searchContacts("bad")).rejects.toThrow(
      "Salesflare error (401): Forbidden",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(salesflareAdapter.listAccounts("k")).rejects.toThrow(
      /Salesflare error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account from /me", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: "Rec Ruiter", email: "r@a.com" }));
    const result = await salesflareAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.salesflare.com/me");
    expect(result).toEqual({ ok: true, accountLabel: "Salesflare (Rec Ruiter)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    const result = await salesflareAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Salesflare error (401): Unauthorized");
  });
});

describe("searchContacts", () => {
  it("renders contacts with the linked account name", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          name: "Ada Lovelace",
          email: "ada@acme.com",
          phone_number: "+1 555",
          account: { name: "Acme" },
        },
      ]),
    );
    const result = await salesflareAdapter.searchContacts("k");
    expect(result.count).toBe(1);
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | +1 555 | Acme | 1 |");
  });

  it("clamps the limit and reports truncation on a full page", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `C${i}` }));
    fetchMock.mockResolvedValueOnce(jsonResponse(rows));
    const result = await salesflareAdapter.searchContacts("k", { limit: 999 });
    expect(requestAt(0).url).toContain("limit=100");
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no contacts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const result = await salesflareAdapter.searchContacts("k");
    expect(result.text).toBe("_No contacts found._");
  });
});

describe("listAccounts and listOpportunities", () => {
  it("renders accounts with website and email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 9, name: "Acme", website: "acme.com", email: "hi@acme.com" }]),
    );
    const result = await salesflareAdapter.listAccounts("k");
    expect(requestAt(0).url).toBe("https://api.salesflare.com/accounts?limit=25");
    expect(result.text).toContain("| Acme | acme.com |  | hi@acme.com | 9 |");
  });

  it("renders opportunities with value, status and account", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 5, name: "Acme retainer", value: 12000, status: "open", account: { name: "Acme" } },
      ]),
    );
    const result = await salesflareAdapter.listOpportunities("k");
    expect(result.text).toContain("| Acme retainer | 12000 | open | Acme | 5 |");
  });
});
