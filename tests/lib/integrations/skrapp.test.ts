import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { skrappAdapter } from "@/lib/integrations/skrapp";
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

describe("auth and errors", () => {
  it("sends the key as an X-Access-Key header with the find params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "a@b.com" }));
    await skrappAdapter.findEmail("my-key", { firstName: "Ada", lastName: "Lovelace", domain: "acme.com" });
    const { url, headers } = lastCall();
    expect(url).toBe(
      "https://api.skrapp.io/api/v2/find?firstName=Ada&lastName=Lovelace&domain=acme.com",
    );
    expect(headers["X-Access-Key"]).toBe("my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Forbidden" }, 403));
    await expect(
      skrappAdapter.findEmail("bad", { firstName: "A", lastName: "B", domain: "x.com" }),
    ).rejects.toThrow("Skrapp error (403): Forbidden");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      skrappAdapter.findEmail("k", { firstName: "A", lastName: "B", domain: "x.com" }),
    ).rejects.toThrow(/Skrapp error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the probe is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: null }));
    const result = await skrappAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Skrapp" });
    expect(lastCall().url).toContain("domain=example.com");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await skrappAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("findEmail", () => {
  it("renders the found email with a string quality and company", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "ada@acme.com", quality: "verified", company: "Acme" }),
    );
    const result = await skrappAdapter.findEmail("k", { firstName: "Ada", lastName: "Lovelace", domain: "acme.com" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("**ada@acme.com**");
    expect(result.text).toContain("quality: verified");
    expect(result.text).toContain("company: Acme");
  });

  it("reads quality from an object shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "x@y.com", quality: { status: "normal" } }),
    );
    const result = await skrappAdapter.findEmail("k", { firstName: "X", lastName: "Y", domain: "y.com" });
    expect(result.text).toContain("quality: normal");
  });

  it("reports a miss when no email comes back", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: null }));
    const result = await skrappAdapter.findEmail("k", { firstName: "No", lastName: "Body", domain: "x.com" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No email found");
  });

  it("requires firstName, lastName, and domain", async () => {
    const result = await skrappAdapter.findEmail("k", { firstName: "Ada", lastName: "", domain: "x.com" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
