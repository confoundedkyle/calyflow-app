import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zerobounceAdapter } from "@/lib/integrations/zerobounce";
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ address: "a@b.com", status: "valid" }));
    await zerobounceAdapter.verifyEmail("my-key", { email: "a@b.com" });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://api.zerobounce.net/v2/validate");
    expect(url.searchParams.get("api_key")).toBe("my-key");
    expect(url.searchParams.get("email")).toBe("a@b.com");
  });

  it("throws on a non-2xx response using the error field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid API Key" }, 401));
    await expect(
      zerobounceAdapter.verifyEmail("bad", { email: "a@b.com" }),
    ).rejects.toThrow("ZeroBounce error (401): Invalid API Key");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      zerobounceAdapter.verifyEmail("k", { email: "a@b.com" }),
    ).rejects.toThrow(/ZeroBounce error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account with the credit balance", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Credits: "4200" }));
    const result = await zerobounceAdapter.validateApiKey!("k");
    expect(urlAt(0).pathname).toBe("/v2/getcredits");
    expect(result).toEqual({ ok: true, accountLabel: "ZeroBounce (4200 credits)" });
  });

  it("rejects when credits come back as -1", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Credits: "-1" }));
    const result = await zerobounceAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("verifyEmail", () => {
  it("reports a valid email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ address: "ada@acme.com", status: "valid", sub_status: "" }),
    );
    const result = await zerobounceAdapter.verifyEmail("k", { email: "ada@acme.com" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("ada@acme.com: valid");
  });

  it("reports an invalid email with its sub-status", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ address: "x@y.com", status: "invalid", sub_status: "mailbox_not_found" }),
    );
    const result = await zerobounceAdapter.verifyEmail("k", { email: "x@y.com" });
    expect(result.ok).toBe(false);
    expect(result.text).toBe("x@y.com: invalid (mailbox_not_found)");
  });

  it("requires an email", async () => {
    const result = await zerobounceAdapter.verifyEmail("k", { email: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
