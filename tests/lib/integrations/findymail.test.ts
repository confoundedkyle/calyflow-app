import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findymailAdapter } from "@/lib/integrations/findymail";
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
  it("sends the key as a Bearer header against the api base", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ contact: null }));
    await findymailAdapter.findEmail("my-key", { name: "A B", domain: "x.com" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://app.findymail.com/api/search/name");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthenticated" }, 401));
    await expect(
      findymailAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("Findymail error (401): Unauthenticated");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      findymailAdapter.verifyEmail("k", { email: "a@b.com" }),
    ).rejects.toThrow(/Findymail error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with remaining finder credits", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ credits: 4200, verifier_credits: 100 }));
    const result = await findymailAdapter.validateApiKey!("k");
    expect(lastCall().url).toBe("https://app.findymail.com/api/credits");
    expect(result).toEqual({ ok: true, accountLabel: "Findymail (4200 finder credits)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthenticated" }, 401));
    const result = await findymailAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Findymail error (401): Unauthenticated");
  });
});

describe("findEmail", () => {
  it("renders the found contact and posts name + domain", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ contact: { name: "Ada Lovelace", email: "ada@acme.com", domain: "acme.com" } }),
    );
    const result = await findymailAdapter.findEmail("k", { name: "Ada Lovelace", domain: "acme.com" });
    expect(lastCall().body).toEqual({ name: "Ada Lovelace", domain: "acme.com" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("**ada@acme.com**");
    expect(result.text).toContain("name: Ada Lovelace");
  });

  it("reports a miss when no contact is returned", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ contact: null }));
    const result = await findymailAdapter.findEmail("k", { name: "Nobody", domain: "x.com" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No email found");
  });

  it("requires both name and domain", async () => {
    const result = await findymailAdapter.findEmail("k", { name: "", domain: "x.com" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("findPhone", () => {
  it("renders a found phone from a nested contact", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ contact: { phone: "+1 555 0100" } }));
    const result = await findymailAdapter.findPhone("k", { linkedinUrl: "https://linkedin.com/in/ada" });
    expect(lastCall().body).toEqual({ linkedin_url: "https://linkedin.com/in/ada" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("+1 555 0100");
  });

  it("reports a miss when no phone is returned", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ contact: null }));
    const result = await findymailAdapter.findPhone("k", { linkedinUrl: "https://x" });
    expect(result.found).toBe(false);
  });
});

describe("verifyEmail", () => {
  it("reports a deliverable email with its provider", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "ada@acme.com", verified: true, provider: "google" }),
    );
    const result = await findymailAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("ada@acme.com: deliverable (provider: google)");
  });

  it("reports an undeliverable email", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "x@y.com", verified: false }));
    const result = await findymailAdapter.verifyEmail("k", { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("undeliverable");
  });
});
