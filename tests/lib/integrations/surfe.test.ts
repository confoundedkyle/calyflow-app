import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { surfeAdapter } from "@/lib/integrations/surfe";
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
    body: (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : undefined,
  };
}

describe("auth and errors", () => {
  it("sends the key as a Bearer header against the v2 enrich endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrichmentID: "e1" }));
    await surfeAdapter.enrich("my-key", { linkedinUrl: "https://linkedin.com/in/ada" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://api.surfe.com/v2/people/enrich");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "bad request" }, 400));
    await expect(
      surfeAdapter.getResult("k", { enrichmentId: "e1" }),
    ).rejects.toThrow("Surfe error (400): bad request");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      surfeAdapter.getResult("k", { enrichmentId: "e1" }),
    ).rejects.toThrow(/Surfe error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the dummy lookup is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await surfeAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Surfe" });
    expect(lastCall().url).toContain("/v2/people/enrich/00000000-0000-0000-0000-000000000000");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await surfeAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("enrich", () => {
  it("wraps the contact in a people array and requests email + mobile", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrichmentID: "enr-9" }));
    const result = await surfeAdapter.enrich("k", {
      firstName: "Ada",
      lastName: "Lovelace",
      companyName: "Acme",
    });
    expect(lastCall().body).toEqual({
      include: { email: true, mobile: true },
      people: [{ firstName: "Ada", lastName: "Lovelace", companyName: "Acme" }],
    });
    expect(result.pending).toBe(true);
    expect(result.text).toContain("enr-9");
  });

  it("rejects insufficient input without calling the API", async () => {
    const result = await surfeAdapter.enrich("k", { firstName: "Ada" });
    expect(result.pending).toBe(false);
    expect(result.text).toContain("Provide a linkedinUrl");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getResult", () => {
  it("renders a completed enrichment with email and mobile", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "COMPLETED",
        people: [
          {
            firstName: "Ada",
            lastName: "Lovelace",
            companyName: "Acme",
            emails: [{ email: "ada@acme.com" }],
            mobilePhones: [{ mobilePhone: "+1 555 0100" }],
          },
        ],
      }),
    );
    const result = await surfeAdapter.getResult("k", { enrichmentId: "e" });
    expect(result.pending).toBe(false);
    expect(result.text).toContain("**Ada Lovelace** at Acme");
    expect(result.text).toContain("Email: ada@acme.com");
    expect(result.text).toContain("Mobile: +1 555 0100");
  });

  it("treats a non-completed status as still-processing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrichmentID: "e9", status: "IN_PROGRESS" }));
    const result = await surfeAdapter.getResult("k", { enrichmentId: "e9" });
    expect(result.pending).toBe(true);
    expect(result.text).toContain("IN_PROGRESS");
  });

  it("requires an enrichmentId", async () => {
    const result = await surfeAdapter.getResult("k", { enrichmentId: "" });
    expect(result.pending).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
