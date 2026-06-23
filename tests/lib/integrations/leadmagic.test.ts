import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leadmagicAdapter } from "@/lib/integrations/leadmagic";
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
    headers: (init as RequestInit).headers as Record<string, string>,
    body: (init as RequestInit).body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  };
}

describe("auth and errors", () => {
  it("sends the key as an X-API-Key header to the v1 finder", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "a@b.com", status: "valid" }));
    await leadmagicAdapter.findEmail("my-key", { firstName: "Ada", domain: "acme.com" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://api.leadmagic.io/v1/people/email-finder");
    expect(headers["X-API-Key"]).toBe("my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Invalid key" }, 401));
    await expect(
      leadmagicAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("LeadMagic error (401): Invalid key");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      leadmagicAdapter.verifyEmail("k", { email: "a@b.com" }),
    ).rejects.toThrow(/LeadMagic error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the probe lookup is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: null, status: null }));
    const result = await leadmagicAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "LeadMagic" });
    expect(lastCall().url).toBe("https://api.leadmagic.io/v1/people/email-finder");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await leadmagicAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("findEmail", () => {
  it("renders the found email with status, name, and company", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        email: "ada@acme.com",
        status: "valid",
        first_name: "Ada",
        last_name: "Lovelace",
        company_name: "Acme",
      }),
    );
    const result = await leadmagicAdapter.findEmail("k", { firstName: "Ada", lastName: "Lovelace", domain: "acme.com" });
    expect(lastCall().body).toEqual({
      first_name: "Ada",
      last_name: "Lovelace",
      full_name: undefined,
      domain: "acme.com",
      company_name: undefined,
    });
    expect(result.found).toBe(true);
    expect(result.text).toContain("**ada@acme.com** (valid)");
    expect(result.text).toContain("name: Ada Lovelace");
    expect(result.text).toContain("company: Acme");
  });

  it("reports a miss when no email is returned", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: null, status: null }));
    const result = await leadmagicAdapter.findEmail("k", { fullName: "Nobody", companyName: "Nowhere" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No email found");
  });

  it("requires a name and a company without calling the API", async () => {
    const result = await leadmagicAdapter.findEmail("k", { firstName: "Ada" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyEmail", () => {
  it("reports the email_status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "ada@acme.com", email_status: "valid" }));
    const result = await leadmagicAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(lastCall().url).toBe("https://api.leadmagic.io/v1/people/email-validation");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ada@acme.com: valid");
  });

  it("treats a non-valid status as not ok", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "x@y.com", email_status: "invalid" }));
    const result = await leadmagicAdapter.verifyEmail("k", { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("invalid");
  });

  it("requires an email", async () => {
    const result = await leadmagicAdapter.verifyEmail("k", { email: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
