import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bouncerAdapter } from "@/lib/integrations/bouncer";
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
  it("sends the key as an x-api-key header to the verify endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "a@b.com", status: "deliverable" }));
    await bouncerAdapter.verifyEmail("my-key", { email: "a@b.com" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://api.usebouncer.com/v1.1/email/verify?email=a%40b.com");
    expect(headers["x-api-key"]).toBe("my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Forbidden" }, 403));
    await expect(
      bouncerAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("Bouncer error (403): Forbidden");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      bouncerAdapter.verifyEmail("k", { email: "a@b.com" }),
    ).rejects.toThrow(/Bouncer error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the probe is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "connection-check@example.com", status: "undeliverable" }));
    const result = await bouncerAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Bouncer" });
    expect(lastCall().url).toContain("/v1.1/email/verify?email=connection-check%40example.com");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await bouncerAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("verifyEmail", () => {
  it("reports a deliverable email with its reason", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "ada@acme.com", status: "deliverable", reason: "accepted_email" }),
    );
    const result = await bouncerAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ada@acme.com: deliverable (accepted_email)");
  });

  it("treats a non-deliverable status as not ok", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "x@y.com", status: "undeliverable", reason: "rejected_email" }),
    );
    const result = await bouncerAdapter.verifyEmail("k", { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("undeliverable (rejected_email)");
  });

  it("requires an email", async () => {
    const result = await bouncerAdapter.verifyEmail("k", { email: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
