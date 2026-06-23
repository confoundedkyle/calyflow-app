import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prospeoAdapter } from "@/lib/integrations/prospeo";
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

describe("auth and errors", () => {
  it("sends the key as an X-KEY header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: false, response: { email: "a@b.com" } }));
    await prospeoAdapter.enrichPerson("my-key", { fullName: "Ada", companyWebsite: "acme.com" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://api.prospeo.io/enrich-person");
    expect(headers["X-KEY"]).toBe("my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: true, message: "INVALID_KEY" }, 401));
    await expect(
      prospeoAdapter.findMobile("bad", { linkedinUrl: "https://x" }),
    ).rejects.toThrow("Prospeo error (401): INVALID_KEY");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      prospeoAdapter.findMobile("k", { linkedinUrl: "https://x" }),
    ).rejects.toThrow(/Prospeo error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with remaining credits", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: false, response: { remaining_credits: 950 } }),
    );
    const result = await prospeoAdapter.validateApiKey!("k");
    expect(lastCall().url).toBe("https://api.prospeo.io/account-information");
    expect(result).toEqual({ ok: true, accountLabel: "Prospeo (950 credits)" });
  });

  it("rejects when the body reports error:true", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: true, message: "INVALID_KEY" }));
    const result = await prospeoAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("INVALID_KEY");
  });
});

describe("enrichPerson", () => {
  it("sends only_verified_email and the data object, and renders the email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        error: false,
        response: { email: "ada@acme.com", email_status: "VERIFIED", full_name: "Ada Lovelace", company: "Acme" },
      }),
    );
    const result = await prospeoAdapter.enrichPerson("k", { fullName: "Ada Lovelace", companyWebsite: "acme.com" });
    expect(lastCall().body).toEqual({
      only_verified_email: true,
      data: { full_name: "Ada Lovelace", company_website: "acme.com" },
    });
    expect(result.found).toBe(true);
    expect(result.text).toContain("**ada@acme.com** (VERIFIED)");
    expect(result.text).toContain("company: Acme");
  });

  it("reports a miss when error:true", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: true, message: "NO_RESULT" }));
    const result = await prospeoAdapter.enrichPerson("k", { linkedinUrl: "https://x" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No verified email found");
    expect(result.text).toContain("NO_RESULT");
  });

  it("requires a fullName or linkedinUrl", async () => {
    const result = await prospeoAdapter.enrichPerson("k", { companyWebsite: "acme.com" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("findMobile", () => {
  it("returns the raw_format phone", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: false, response: { raw_format: "+1 555 0100" } }),
    );
    const result = await prospeoAdapter.findMobile("k", { linkedinUrl: "https://linkedin.com/in/ada" });
    expect(lastCall().body).toEqual({ url: "https://linkedin.com/in/ada" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("+1 555 0100");
  });

  it("reports a miss when no phone comes back", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: false, response: {} }));
    const result = await prospeoAdapter.findMobile("k", { linkedinUrl: "https://x" });
    expect(result.found).toBe(false);
  });

  it("requires a linkedinUrl", async () => {
    const result = await prospeoAdapter.findMobile("k", { linkedinUrl: "" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
