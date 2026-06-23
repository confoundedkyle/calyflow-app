import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nymeriaAdapter } from "@/lib/integrations/nymeria";
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
  it("sends the key as an X-Api-Key header against the v4 base with the profile param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { work_email: "a@b.com" } }));
    await nymeriaAdapter.enrichPerson("my-key", { linkedinUrl: "https://linkedin.com/in/ada" });
    const { url, headers } = lastCall();
    expect(url).toBe(
      "https://www.nymeria.io/api/v4/person/enrich?profile=https%3A%2F%2Flinkedin.com%2Fin%2Fada",
    );
    expect(headers["X-Api-Key"]).toBe("my-key");
  });

  it("throws on a non-2xx (non-404) response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Rate limited" }, 429));
    await expect(
      nymeriaAdapter.enrichPerson("k", { email: "a@b.com" }),
    ).rejects.toThrow("Nymeria error (429): Rate limited");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      nymeriaAdapter.enrichPerson("k", { email: "a@b.com" }),
    ).rejects.toThrow(/Nymeria error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key when the probe is not an auth error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const result = await nymeriaAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Nymeria" });
    expect(lastCall().url).toBe("https://www.nymeria.io/api/v4/person/enrich");
  });

  it("rejects a key that returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const result = await nymeriaAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected the API key");
  });
});

describe("enrichPerson", () => {
  it("renders the work email, phone, name, title, and company", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 200,
        data: {
          first_name: "Ada",
          last_name: "Lovelace",
          work_email: "ada@acme.com",
          personal_emails: ["ada@home.com"],
          mobile_phone: "+1 555 0100",
          job_title: "CTO",
          job_company_name: "Acme",
        },
      }),
    );
    const result = await nymeriaAdapter.enrichPerson("k", { email: "ada@home.com" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("**Ada Lovelace** — CTO at Acme");
    expect(result.text).toContain("Email: ada@acme.com");
    expect(result.text).toContain("Phone: +1 555 0100");
  });

  it("falls back to a personal email when there is no work email", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { first_name: "Bo", personal_emails: ["bo@home.com"] } }),
    );
    const result = await nymeriaAdapter.enrichPerson("k", { linkedinUrl: "https://x" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("Email: bo@home.com");
  });

  it("treats a 404 as a miss", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await nymeriaAdapter.enrichPerson("k", { email: "nobody@nowhere.com" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No match found");
  });

  it("reports a miss when the record has no contact details", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { first_name: "Ada" } }));
    const result = await nymeriaAdapter.enrichPerson("k", { email: "a@b.com" });
    expect(result.found).toBe(false);
  });

  it("requires a linkedinUrl or email", async () => {
    const result = await nymeriaAdapter.enrichPerson("k", {});
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
