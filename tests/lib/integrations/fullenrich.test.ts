import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullenrichAdapter } from "@/lib/integrations/fullenrich";
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
  it("sends the key as a Bearer header against the v2 base", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrichment_id: "e1" }));
    await fullenrichAdapter.enrich("my-key", { firstName: "A", lastName: "B", domain: "x.com" });
    const { url, headers } = lastCall();
    expect(url).toBe("https://app.fullenrich.com/api/v2/contact/enrich/bulk");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "bad request" }, 400));
    await expect(
      fullenrichAdapter.getResult("k", { enrichmentId: "e1" }),
    ).rejects.toThrow("FullEnrich error (400): bad request");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      fullenrichAdapter.getResult("k", { enrichmentId: "e1" }),
    ).rejects.toThrow(/FullEnrich error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the dummy lookup is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await fullenrichAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "FullEnrich" });
    expect(lastCall().url).toContain("/contact/enrich/bulk/00000000-0000-0000-0000-000000000000");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await fullenrichAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("enrich", () => {
  it("maps fields to FullEnrich's snake_case datas row", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrichment_id: "e9" }));
    await fullenrichAdapter.enrich("k", {
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Acme",
      linkedinUrl: "https://linkedin.com/in/ada",
    });
    expect(lastCall().body).toEqual({
      name: "Calyflow enrichment",
      datas: [
        {
          firstname: "Ada",
          lastname: "Lovelace",
          company_name: "Acme",
          linkedin_url: "https://linkedin.com/in/ada",
        },
      ],
    });
  });

  it("returns a pending result carrying the enrichment id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrichment_id: "enr-42" }));
    const result = await fullenrichAdapter.enrich("k", { linkedinUrl: "https://x" });
    expect(result.pending).toBe(true);
    expect(result.text).toContain("enr-42");
  });

  it("rejects an empty contact without calling the API", async () => {
    const result = await fullenrichAdapter.enrich("k", {});
    expect(result.pending).toBe(false);
    expect(result.text).toContain("Provide at least");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getResult", () => {
  it("renders a finished enrichment, picking the first email + phone", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "FINISHED",
        datas: [
          {
            firstname: "Ada",
            lastname: "Lovelace",
            company_name: "Acme",
            contact: {
              emails: [{ email: "ada@acme.com" }],
              phones: [{ number: "+1 555 0100" }],
            },
          },
        ],
      }),
    );
    const result = await fullenrichAdapter.getResult("k", { enrichmentId: "e" });
    expect(result.pending).toBe(false);
    expect(result.text).toContain("**Ada Lovelace** at Acme");
    expect(result.text).toContain("Email: ada@acme.com");
    expect(result.text).toContain("Phone: +1 555 0100");
  });

  it("treats a non-finished status as still-processing (pending)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ enrichment_id: "e9", status: "IN_PROGRESS" }),
    );
    const result = await fullenrichAdapter.getResult("k", { enrichmentId: "e9" });
    expect(result.pending).toBe(true);
    expect(result.text).toContain("e9");
    expect(result.text).toContain("IN_PROGRESS");
  });

  it("requires an enrichmentId", async () => {
    const result = await fullenrichAdapter.getResult("k", { enrichmentId: "" });
    expect(result.text).toContain("Provide the enrichmentId");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
