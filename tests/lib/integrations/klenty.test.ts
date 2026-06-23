import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { klentyAdapter } from "@/lib/integrations/klenty";
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
  return { url: url as string, headers: (init as RequestInit).headers as Record<string, string> };
}

const CRED = "rep@agency.com:secret-key";

describe("auth and credential parsing", () => {
  it("scopes the path by the user email and sends the x-API-key header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await klentyAdapter.listCadences(CRED);
    const { url, headers } = lastCall();
    expect(url).toBe("https://app.klenty.com/apis/v1/user/rep%40agency.com/cadences");
    expect(headers["x-API-key"]).toBe("secret-key");
  });

  it("rejects a credential without an email", async () => {
    const result = await klentyAdapter.validateApiKey!("not-an-email:key");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("your-login-email:api-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Forbidden" }, 401));
    await expect(klentyAdapter.listCadences(CRED)).rejects.toThrow(
      "Klenty error (401): Forbidden",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(klentyAdapter.listCadences(CRED)).rejects.toThrow(/Klenty error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with the user email", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const result = await klentyAdapter.validateApiKey!(CRED);
    expect(result).toEqual({ ok: true, accountLabel: "Klenty (rep@agency.com)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await klentyAdapter.validateApiKey!(CRED);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Klenty error (401): Unauthorized");
  });
});

describe("listCadences", () => {
  it("renders cadences from a bare array", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "cad_1", name: "Q3 Outbound" },
        { id: "cad_2", name: "Re-engage" },
      ]),
    );
    const result = await klentyAdapter.listCadences(CRED);
    expect(result.count).toBe(2);
    expect(result.text).toContain("| Q3 Outbound | cad_1 |");
    expect(result.text).toContain("| Re-engage | cad_2 |");
  });

  it("renders a placeholder when there are no cadences", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const result = await klentyAdapter.listCadences(CRED);
    expect(result.text).toBe("_No cadences._");
  });
});

describe("getProspect", () => {
  it("renders a prospect looked up by email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Email: "ada@acme.com",
        FirstName: "Ada",
        LastName: "Lovelace",
        Title: "CTO",
        Company: "Acme",
        Phone: "+1 555",
        prospectStatus: "Active",
      }),
    );
    const result = await klentyAdapter.getProspect(CRED, { email: "ada@acme.com" });
    expect(lastCall().url).toBe(
      "https://app.klenty.com/apis/v1/user/rep%40agency.com/ada%40acme.com",
    );
    expect(result.found).toBe(true);
    expect(result.text).toContain("**Ada Lovelace** — CTO at Acme");
    expect(result.text).toContain("Status: Active");
  });

  it("reports a miss when the prospect has no email", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const result = await klentyAdapter.getProspect(CRED, { email: "nobody@nowhere.com" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No prospect found");
  });

  it("requires a prospect email", async () => {
    const result = await klentyAdapter.getProspect(CRED, { email: "" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
