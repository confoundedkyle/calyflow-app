import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copperAdapter } from "@/lib/integrations/copper";
import { jsonResponse, textResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: url as string,
    init: init as RequestInit,
    headers: (init as RequestInit).headers as Record<string, string>,
    body: (init as RequestInit).body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  };
}

const CRED = "rec@agency.com:secret-key";

describe("auth and credential parsing", () => {
  it("sends the three X-PW headers and posts the search body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await copperAdapter.searchPeople(CRED, { name: "ada", limit: 10, page: 2 });
    const { url, init, headers, body } = lastCall();
    expect(url).toBe("https://api.copper.com/developer_api/v1/people/search");
    expect(init.method).toBe("POST");
    expect(headers["X-PW-AccessToken"]).toBe("secret-key");
    expect(headers["X-PW-UserEmail"]).toBe("rec@agency.com");
    expect(headers["X-PW-Application"]).toBe("developer_api");
    expect(body).toEqual({ page_size: 10, page_number: 2, name: "ada" });
  });

  it("rejects a credential without an email", async () => {
    const result = await copperAdapter.validateApiKey!("not-an-email:key");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("your-email:api-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Forbidden" }, 403));
    await expect(copperAdapter.searchPeople(CRED)).rejects.toThrow(
      "Copper error (403): Forbidden",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(copperAdapter.searchCompanies(CRED)).rejects.toThrow(
      /Copper error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account from /account", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: "Acme Recruiting" }));
    const result = await copperAdapter.validateApiKey!(CRED);
    expect(lastCall().url).toBe("https://api.copper.com/developer_api/v1/account");
    expect(result).toEqual({ ok: true, accountLabel: "Copper (Acme Recruiting)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await copperAdapter.validateApiKey!(CRED);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Copper error (401): Unauthorized");
  });
});

describe("searchPeople", () => {
  it("renders people with the first email/phone", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          name: "Ada Lovelace",
          title: "CTO",
          company_name: "Acme",
          emails: [{ email: "ada@acme.com", category: "work" }],
          phone_numbers: [{ number: "+1 555", category: "mobile" }],
        },
      ]),
    );
    const result = await copperAdapter.searchPeople(CRED);
    expect(result.count).toBe(1);
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | +1 555 | Acme | CTO | 1 |");
  });

  it("reports truncation when a full page comes back", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `P${i}` }));
    fetchMock.mockResolvedValueOnce(jsonResponse(rows));
    const result = await copperAdapter.searchPeople(CRED);
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no people", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const result = await copperAdapter.searchPeople(CRED);
    expect(result.text).toBe("_No people found._");
  });
});

describe("searchCompanies and searchOpportunities", () => {
  it("renders companies with their email domain", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 9, name: "Acme", email_domain: "acme.com" }]),
    );
    const result = await copperAdapter.searchCompanies(CRED);
    expect(result.text).toContain("| Acme | acme.com |  | 9 |");
  });

  it("renders opportunities with status and value", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 5, name: "Acme retainer", status: "Open", monetary_value: 12000, company_name: "Acme" },
      ]),
    );
    const result = await copperAdapter.searchOpportunities(CRED);
    expect(result.text).toContain("| Acme retainer | Open | 12000 | Acme | 5 |");
  });
});
