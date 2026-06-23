import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tombaAdapter } from "@/lib/integrations/tomba";
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

const CRED = "ta_key:ts_secret";

describe("auth and credential parsing", () => {
  it("sends the key and secret as X-Tomba headers to the finder", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { email: "a@b.com" } }));
    await tombaAdapter.findEmail(CRED, { firstName: "Ada", lastName: "Lovelace", domain: "acme.com" });
    const { url, headers } = lastCall();
    expect(url).toBe(
      "https://api.tomba.io/v1/email-finder/acme.com?first_name=Ada&last_name=Lovelace",
    );
    expect(headers["X-Tomba-Key"]).toBe("ta_key");
    expect(headers["X-Tomba-Secret"]).toBe("ts_secret");
  });

  it("rejects a malformed credential without a network call", async () => {
    const result = await tombaAdapter.validateApiKey!("no-colon");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("key:secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    await expect(
      tombaAdapter.verifyEmail(CRED, { email: "a@b.com" }),
    ).rejects.toThrow("Tomba error (401): Unauthorized");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      tombaAdapter.verifyEmail(CRED, { email: "a@b.com" }),
    ).rejects.toThrow(/Tomba error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a credential when the probe is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { result: "undeliverable" } }));
    const result = await tombaAdapter.validateApiKey!(CRED);
    expect(result).toEqual({ ok: true, accountLabel: "Tomba" });
    expect(lastCall().url).toContain("/v1/email-verifier/connection-check%40example.com");
  });

  it("rejects credentials that return 403", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const result = await tombaAdapter.validateApiKey!(CRED);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the credentials");
  });
});

describe("findEmail", () => {
  it("renders the found email with score, title, and company", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { email: "ada@acme.com", score: 97, position: "CTO", company: "Acme" } }),
    );
    const result = await tombaAdapter.findEmail(CRED, { firstName: "Ada", lastName: "Lovelace", domain: "acme.com" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("**ada@acme.com**");
    expect(result.text).toContain("score: 97");
    expect(result.text).toContain("company: Acme");
  });

  it("reports a miss when no email comes back", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { email: null } }));
    const result = await tombaAdapter.findEmail(CRED, { firstName: "No", lastName: "Body", domain: "x.com" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No email found");
  });

  it("requires firstName, lastName, and domain", async () => {
    const result = await tombaAdapter.findEmail(CRED, { firstName: "Ada", lastName: "", domain: "x.com" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyEmail", () => {
  it("reports the result from top-level data fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { email: "ada@acme.com", result: "deliverable", status: "valid" } }));
    const result = await tombaAdapter.verifyEmail(CRED, { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ada@acme.com: deliverable (valid)");
  });

  it("reads result from a nested email object", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { email: { email: "x@y.com", result: "undeliverable", status: "invalid" } } }),
    );
    const result = await tombaAdapter.verifyEmail(CRED, { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("undeliverable (invalid)");
  });
});
