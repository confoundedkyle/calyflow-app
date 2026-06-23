import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trestleAdapter } from "@/lib/integrations/trestle";
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
  it("sends the key as an x-api-key header to the phone endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ phone_number: "+14155551234", is_valid: true }));
    await trestleAdapter.validatePhone("my-key", { phone: "+14155551234" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://api.trestleiq.com/3.1/phone?phone=%2B14155551234");
    expect(headers["x-api-key"]).toBe("my-key");
  });

  it("throws on a non-2xx response using the error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Forbidden" } }, 403));
    await expect(
      trestleAdapter.validatePhone("bad", { phone: "+1" }),
    ).rejects.toThrow("Trestle error (403): Forbidden");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      trestleAdapter.validatePhone("k", { phone: "+1" }),
    ).rejects.toThrow(/Trestle error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the probe is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ is_valid: false }));
    const result = await trestleAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Trestle" });
    expect(lastCall().url).toContain("/3.1/phone?phone=%2B12025550123");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await trestleAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("validatePhone", () => {
  it("renders a valid mobile with carrier and activity", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        phone_number: "+14155551234",
        is_valid: true,
        line_type: "Mobile",
        carrier: "Verizon",
        activity_score: 85,
      }),
    );
    const result = await trestleAdapter.validatePhone("k", { phone: "+14155551234" });
    expect(result.valid).toBe(true);
    expect(result.text).toBe(
      "+14155551234: valid · line: Mobile · carrier: Verizon · activity: 85/100",
    );
  });

  it("reports an invalid number", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ phone_number: "+10", is_valid: false }));
    const result = await trestleAdapter.validatePhone("k", { phone: "+10" });
    expect(result.valid).toBe(false);
    expect(result.text).toContain("+10: invalid");
  });

  it("requires a phone number", async () => {
    const result = await trestleAdapter.validatePhone("k", { phone: "" });
    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
