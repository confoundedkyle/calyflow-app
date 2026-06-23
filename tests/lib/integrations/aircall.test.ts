import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aircallAdapter } from "@/lib/integrations/aircall";
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

const CRED = "myid:mytoken";

describe("auth and credential parsing", () => {
  it("sends Basic auth (id:token) to /calls", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ calls: [] }));
    await aircallAdapter.listCalls(CRED);
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.aircall.io/v1/calls?per_page=25");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("myid:mytoken").toString("base64")}`,
    );
  });

  it("rejects a malformed credential without a network call", async () => {
    const result = await aircallAdapter.validateApiKey!("no-colon");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("api-id:api-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the troubleshoot field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ troubleshoot: "bad api key" }, 401));
    await expect(aircallAdapter.listCalls(CRED)).rejects.toThrow(
      "Aircall error (401): bad api key",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(aircallAdapter.listContacts(CRED)).rejects.toThrow(/Aircall error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a credential that can list one call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ calls: [] }));
    const result = await aircallAdapter.validateApiKey!(CRED);
    expect(requestAt(0).url).toBe("https://api.aircall.io/v1/calls?per_page=1");
    expect(result).toEqual({ ok: true, accountLabel: "Aircall" });
  });
});

describe("listCalls", () => {
  it("renders calls, converting the unix started_at, and reports more pages", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        calls: [
          {
            id: 1,
            direction: "inbound",
            status: "done",
            duration: 182,
            raw_digits: "+14155550001",
            started_at: 1781000000,
          },
        ],
        meta: { next_page_link: "https://api.aircall.io/v1/calls?page=2" },
      }),
    );
    const result = await aircallAdapter.listCalls(CRED);
    expect(result.count).toBe(1);
    expect(result.text).toContain("| inbound | done | 182 | +14155550001 |");
    expect(result.text).toContain("| 1 |");
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no calls", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ calls: [] }));
    const result = await aircallAdapter.listCalls(CRED);
    expect(result.text).toBe("_No calls._");
  });
});

describe("listContacts", () => {
  it("renders contacts with the first phone and email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        contacts: [
          {
            id: 9,
            first_name: "Ada",
            last_name: "Lovelace",
            company_name: "Acme",
            phone_numbers: [{ value: "+14155550002" }],
            emails: [{ value: "ada@acme.com" }],
          },
        ],
      }),
    );
    const result = await aircallAdapter.listContacts(CRED);
    expect(requestAt(0).url).toBe("https://api.aircall.io/v1/contacts?per_page=25");
    expect(result.text).toContain(
      "| Ada Lovelace | Acme | +14155550002 | ada@acme.com | 9 |",
    );
  });

  it("clamps the limit to 50", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ contacts: [] }));
    await aircallAdapter.listContacts(CRED, { limit: 999 });
    expect(requestAt(0).url).toContain("per_page=50");
  });
});
