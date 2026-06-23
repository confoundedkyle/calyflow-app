import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wizaAdapter } from "@/lib/integrations/wiza";
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 1 } }));
    await wizaAdapter.reveal("my-key", { linkedinUrl: "https://linkedin.com/in/x" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://wiza.co/api/individual_reveals");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the status message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: { message: "Invalid API key" } }, 401));
    await expect(
      wizaAdapter.getResult("bad", { revealId: "5" }),
    ).rejects.toThrow("Wiza error (401): Invalid API key");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      wizaAdapter.getResult("k", { revealId: "5" }),
    ).rejects.toThrow(/Wiza error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the dummy lookup is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await wizaAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Wiza" });
    expect(lastCall().url).toBe("https://wiza.co/api/individual_reveals/0");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await wizaAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("reveal", () => {
  it("wraps a LinkedIn input and requests a full reveal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 42, status: "queued" } }));
    const result = await wizaAdapter.reveal("k", { linkedinUrl: "https://linkedin.com/in/ada" });
    expect(lastCall().body).toEqual({
      individual_reveal: { profile_url: "https://linkedin.com/in/ada" },
      enrichment_level: "full",
      email_options: { accept_work: true, accept_personal: true },
    });
    expect(result.pending).toBe(true);
    expect(result.text).toContain("42");
  });

  it("uses full_name + company when no LinkedIn or email is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 7 } }));
    await wizaAdapter.reveal("k", { fullName: "Ada Lovelace", company: "Acme" });
    expect(lastCall().body.individual_reveal).toEqual({
      full_name: "Ada Lovelace",
      company: "Acme",
    });
  });

  it("rejects input that has neither LinkedIn, email, nor name+company", async () => {
    const result = await wizaAdapter.reveal("k", { fullName: "Ada" });
    expect(result.pending).toBe(false);
    expect(result.text).toContain("Provide a linkedinUrl");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getResult", () => {
  it("renders a finished reveal with email and mobile phone", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: 42,
          status: "finished",
          is_complete: true,
          name: "Ada Lovelace",
          title: "CTO",
          company: "Acme",
          email: "ada@acme.com",
          mobile_phone: "+1 555 0100",
        },
      }),
    );
    const result = await wizaAdapter.getResult("k", { revealId: "42" });
    expect(result.pending).toBe(false);
    expect(result.text).toContain("**Ada Lovelace** — CTO at Acme");
    expect(result.text).toContain("Email: ada@acme.com");
    expect(result.text).toContain("Phone: +1 555 0100");
  });

  it("treats an incomplete reveal as still-processing (pending)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { id: 9, status: "resolving", is_complete: false } }),
    );
    const result = await wizaAdapter.getResult("k", { revealId: "9" });
    expect(result.pending).toBe(true);
    expect(result.text).toContain("resolving");
  });

  it("reports a failed reveal", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { id: 9, status: "failed", is_complete: true } }),
    );
    const result = await wizaAdapter.getResult("k", { revealId: "9" });
    expect(result.pending).toBe(false);
    expect(result.text).toContain("failed");
  });

  it("requires a revealId", async () => {
    const result = await wizaAdapter.getResult("k", { revealId: "" });
    expect(result.text).toContain("Provide the revealId");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
