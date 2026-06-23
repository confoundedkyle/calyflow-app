import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { millionverifierAdapter } from "@/lib/integrations/millionverifier";
import { jsonResponse, textResponse } from "../../helpers/http";

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
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "a@b.com", result: "ok" }));
    await millionverifierAdapter.verifyEmail("my-key", { email: "a@b.com" });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://api.millionverifier.com/api/v3/");
    expect(url.searchParams.get("api")).toBe("my-key");
    expect(url.searchParams.get("email")).toBe("a@b.com");
  });

  it("throws when the body reports an error (HTTP 200)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }));
    await expect(
      millionverifierAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("MillionVerifier error: Invalid API key");
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      millionverifierAdapter.verifyEmail("k", { email: "a@b.com" }),
    ).rejects.toThrow(/MillionVerifier error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with remaining credits", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ email: "connection-check@example.com", result: "invalid", credits: 9500 }),
    );
    const result = await millionverifierAdapter.validateApiKey!("k");
    expect(urlAt(0).searchParams.get("email")).toBe("connection-check@example.com");
    expect(result).toEqual({ ok: true, accountLabel: "MillionVerifier (9500 credits)" });
  });

  it("rejects when the body reports an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }));
    const result = await millionverifierAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid API key");
  });
});

describe("verifyEmail", () => {
  it("reports an ok email with its quality", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "ada@acme.com", result: "ok", quality: "good" }));
    const result = await millionverifierAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ada@acme.com: ok (good)");
  });

  it("reports a non-ok result as not ok", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "x@y.com", result: "disposable" }));
    const result = await millionverifierAdapter.verifyEmail("k", { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("disposable");
  });

  it("requires an email", async () => {
    const result = await millionverifierAdapter.verifyEmail("k", { email: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
