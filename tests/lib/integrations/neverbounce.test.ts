import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { neverbounceAdapter } from "@/lib/integrations/neverbounce";
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", result: "valid" }));
    await neverbounceAdapter.verifyEmail("my-key", { email: "a@b.com" });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://api.neverbounce.com/v4/single/check");
    expect(url.searchParams.get("key")).toBe("my-key");
    expect(url.searchParams.get("email")).toBe("a@b.com");
  });

  it("throws when the body reports a non-success status (HTTP 200)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "auth_failure", message: "API key is invalid" }),
    );
    await expect(
      neverbounceAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("NeverBounce error: API key is invalid");
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      neverbounceAdapter.verifyEmail("k", { email: "a@b.com" }),
    ).rejects.toThrow(/NeverBounce error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with remaining paid credits", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "success", credits_info: { paid_credits_remaining: 5000 } }),
    );
    const result = await neverbounceAdapter.validateApiKey!("k");
    expect(urlAt(0).pathname).toBe("/v4/account/info");
    expect(result).toEqual({ ok: true, accountLabel: "NeverBounce (5000 credits)" });
  });

  it("rejects when the body reports auth_failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "auth_failure", message: "bad key" }));
    const result = await neverbounceAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("bad key");
  });
});

describe("verifyEmail", () => {
  it("reports a valid email", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", result: "valid" }));
    const result = await neverbounceAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ada@acme.com: valid");
  });

  it("reports a non-valid result as not ok", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", result: "disposable" }));
    const result = await neverbounceAdapter.verifyEmail("k", { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("disposable");
  });

  it("requires an email", async () => {
    const result = await neverbounceAdapter.verifyEmail("k", { email: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
