import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insightlyAdapter } from "@/lib/integrations/insightly";
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

const CRED = "na1:secret-key";

describe("auth and credential parsing", () => {
  it("builds the pod host and sends Basic auth with the key as username", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await insightlyAdapter.listContacts(CRED);
    const { url, headers } = requestAt(0);
    expect(url).toBe(
      "https://api.na1.insightly.com/v3.1/Contacts?top=25&brief=false",
    );
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("secret-key:").toString("base64")}`,
    );
  });

  it("rejects a malformed credential without a network call", async () => {
    const result = await insightlyAdapter.validateApiKey!("no-colon");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("pod:api-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the Message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "Forbidden" }, 401));
    await expect(insightlyAdapter.listContacts(CRED)).rejects.toThrow(
      "Insightly error (401): Forbidden",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(insightlyAdapter.listOrganisations(CRED)).rejects.toThrow(
      /Insightly error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account from /Users/Me", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ FIRST_NAME: "Rec", LAST_NAME: "Ruiter", EMAIL_ADDRESS: "r@a.com" }),
    );
    const result = await insightlyAdapter.validateApiKey!(CRED);
    expect(requestAt(0).url).toBe("https://api.na1.insightly.com/v3.1/Users/Me");
    expect(result).toEqual({ ok: true, accountLabel: "Insightly (Rec Ruiter)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "Unauthorized" }, 401));
    const result = await insightlyAdapter.validateApiKey!(CRED);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Insightly error (401): Unauthorized");
  });
});

describe("listContacts", () => {
  it("renders contacts, pulling email/phone from CONTACTINFOS", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          CONTACT_ID: 1,
          FIRST_NAME: "Ada",
          LAST_NAME: "Lovelace",
          TITLE: "CTO",
          ORGANISATION_NAME: "Acme",
          CONTACTINFOS: [
            { TYPE: "EMAIL", DETAIL: "ada@acme.com" },
            { TYPE: "PHONE_MOBILE", DETAIL: "+1 555" },
          ],
        },
      ]),
    );
    const result = await insightlyAdapter.listContacts(CRED);
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Ada Lovelace | ada@acme.com | +1 555 | Acme | CTO | 1 |",
    );
  });

  it("renders a placeholder when there are no contacts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const result = await insightlyAdapter.listContacts(CRED);
    expect(result.text).toBe("_No contacts found._");
  });
});

describe("listOrganisations and listOpportunities", () => {
  it("renders an organisation with its phone", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { ORGANISATION_ID: 9, ORGANISATION_NAME: "Acme", CONTACTINFOS: [{ TYPE: "PHONE", DETAIL: "+1 999" }] },
      ]),
    );
    const result = await insightlyAdapter.listOrganisations(CRED);
    expect(requestAt(0).url).toContain("/Organisations?top=25");
    expect(result.text).toContain("| Acme | +1 999 | 9 |");
  });

  it("renders an opportunity with value, currency and state", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { OPPORTUNITY_ID: 5, OPPORTUNITY_NAME: "Acme retainer", OPPORTUNITY_VALUE: 12000, BID_CURRENCY: "USD", OPPORTUNITY_STATE: "OPEN" },
      ]),
    );
    const result = await insightlyAdapter.listOpportunities(CRED);
    expect(result.text).toContain("| Acme retainer | 12000 USD | OPEN | 5 |");
  });
});
