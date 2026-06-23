import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailableAdapter } from "@/lib/integrations/emailable";
import { jsonResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function urlAt(index: number): URL {
  return new URL(fetchMock.mock.calls[index][0] as string);
}

describe("auth and errors", () => {
  it("passes the api key and email as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "a@b.com", state: "deliverable" }));
    await emailableAdapter.verifyEmail("my-key", { email: "a@b.com" });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://api.emailable.com/v1/verify");
    expect(url.searchParams.get("api_key")).toBe("my-key");
    expect(url.searchParams.get("email")).toBe("a@b.com");
  });

  it("throws on a 4xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "invalid key" }, 401));
    await expect(
      emailableAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("Emailable error (401): invalid key");
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the probe is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "connection-check@example.com", state: "undeliverable" }));
    const result = await emailableAdapter.validateApiKey!("k");
    const url = urlAt(0);
    expect(url.searchParams.get("email")).toBe("connection-check@example.com");
    expect(url.searchParams.get("smtp")).toBe("false");
    expect(result).toEqual({ ok: true, accountLabel: "Emailable" });
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "bad key" }, 401));
    const result = await emailableAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("verifyEmail", () => {
  it("reports a deliverable email with its reason", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "ada@acme.com", state: "deliverable", reason: "accepted_email" }),
    );
    const result = await emailableAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ada@acme.com: deliverable (accepted_email)");
  });

  it("includes a did_you_mean suggestion and reports non-deliverable as not ok", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "ada@gmial.com", state: "undeliverable", reason: "rejected_email", did_you_mean: "ada@gmail.com" }),
    );
    const result = await emailableAdapter.verifyEmail("k", { email: "ada@gmial.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("did you mean ada@gmail.com?");
  });

  it("requires an email", async () => {
    const result = await emailableAdapter.verifyEmail("k", { email: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
