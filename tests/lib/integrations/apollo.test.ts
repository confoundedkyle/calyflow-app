import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apolloAdapter } from "@/lib/integrations/apollo";
import { jsonResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("validateApiKey", () => {
  it("GETs the auth health endpoint with the api key (header + query)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ is_logged_in: true }));
    const result = await apolloAdapter.validateApiKey!("key-1");
    expect(result).toEqual({ ok: true, accountLabel: "Apollo account" });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toContain("/v1/auth/health");
    expect(url).toContain("api_key=key-1");
    expect(init.method ?? "GET").toBe("GET"); // not a POST
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("key-1");
  });

  it("rejects a key Apollo reports as logged out", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ is_logged_in: false }));
    const result = await apolloAdapter.validateApiKey!("key-1");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Apollo rejected the API key.");
  });

  it("rejects an unauthorized key (401/403)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "invalid api key" }, 401),
    );
    const result = await apolloAdapter.validateApiKey!("bad-key");
    expect(result).toEqual({ ok: false, message: "Apollo rejected the API key." });
  });

  it("surfaces other HTTP errors with status + detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "server oops" }, 500));
    const result = await apolloAdapter.validateApiKey!("key-1");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Apollo error (500): server oops");
  });
});

describe("searchPeople", () => {
  it("requires a domain, company, or title without calling the API", async () => {
    const result = await apolloAdapter.searchPeople("k", {});
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps args to the Apollo request body and clamps the limit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ people: [] }));
    await apolloAdapter.searchPeople("k", {
      domain: "acme.com",
      titles: ["CTO", "VP Engineering"],
      seniorities: ["c_suite"],
      locations: ["Berlin"],
      limit: 500,
    });
    const { url, body } = lastRequest();
    expect(url).toBe("https://api.apollo.io/api/v1/mixed_people/search");
    expect(body).toEqual({
      page: 1,
      per_page: 100,
      q_organization_domains: "acme.com",
      person_titles: ["CTO", "VP Engineering"],
      person_seniorities: ["c_suite"],
      person_locations: ["Berlin"],
    });
  });

  it("renders a markdown table and escapes pipes and newlines", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        people: [
          {
            name: "Ada | Lovelace",
            title: "Chief\nEngineer",
            email: "ada@acme.com",
            email_status: "verified",
            organization: { name: "Acme" },
            city: "London",
            country: "UK",
          },
        ],
        pagination: { total_entries: 1 },
      }),
    );
    const result = await apolloAdapter.searchPeople("k", { domain: "acme.com" });
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("| Name | Title | Company | Location | Email | Email status |");
    expect(result.text).toContain("Ada \\| Lovelace");
    expect(result.text).toContain("Chief Engineer");
    expect(result.text).toContain("London, UK");
  });

  it("flags truncation when more entries exist than were returned", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        people: [{ name: "Only One" }],
        pagination: { total_entries: 42 },
      }),
    );
    const result = await apolloAdapter.searchPeople("k", { company: "Acme" });
    expect(result.truncated).toBe(true);
  });
});

describe("enrichPerson", () => {
  it("requires a name", async () => {
    const result = await apolloAdapter.enrichPerson("k", { domain: "acme.com" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a company or domain", async () => {
    const result = await apolloAdapter.enrichPerson("k", { fullName: "Ada" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not found when Apollo has no match", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ person: null }));
    const result = await apolloAdapter.enrichPerson("k", {
      fullName: "Ada Lovelace",
      domain: "acme.com",
    });
    expect(result.found).toBe(false);
    expect(result.text).toBe("No match found for that person.");
  });

  it("forwards revealEmail and renders contact details", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        person: {
          name: "Ada Lovelace",
          title: "CTO",
          email: "ada@acme.com",
          email_status: "verified",
          linkedin_url: "https://linkedin.com/in/ada",
          phone_numbers: [{ raw_number: "+44 123" }],
          organization: { name: "Acme" },
        },
      }),
    );
    const result = await apolloAdapter.enrichPerson("k", {
      fullName: "Ada Lovelace",
      domain: "acme.com",
      revealEmail: true,
    });
    const { url, body } = lastRequest();
    expect(url).toBe("https://api.apollo.io/api/v1/people/match");
    expect(body.reveal_personal_emails).toBe(true);
    expect(body.name).toBe("Ada Lovelace");
    expect(result.found).toBe(true);
    expect(result.text).toContain("**Ada Lovelace** — CTO at Acme");
    expect(result.text).toContain("Email: ada@acme.com (verified)");
    expect(result.text).toContain("Phone: +44 123");
    expect(result.text).toContain("LinkedIn: https://linkedin.com/in/ada");
  });

  it("is not found when the match has no email or phone", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        person: { name: "Ada Lovelace", linkedin_url: "https://linkedin.com/in/ada" },
      }),
    );
    const result = await apolloAdapter.enrichPerson("k", {
      fullName: "Ada Lovelace",
      company: "Acme",
    });
    expect(result.found).toBe(false);
  });
});

describe("searchOrganizations", () => {
  it("requires at least one filter", async () => {
    const result = await apolloAdapter.searchOrganizations("k", {});
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps filters and renders companies", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organizations: [
          {
            name: "Acme",
            primary_domain: "acme.com",
            industry: "software",
            estimated_num_employees: 250,
            city: "Berlin",
            country: "DE",
          },
        ],
        pagination: { total_entries: 9000 },
      }),
    );
    const result = await apolloAdapter.searchOrganizations("k", {
      keywords: "recruiting",
      employeeRanges: ["51,200"],
    });
    const { url, body } = lastRequest();
    expect(url).toBe("https://api.apollo.io/api/v1/mixed_companies/search");
    expect(body.q_organization_keyword_tags).toBe("recruiting");
    expect(body.organization_num_employees_ranges).toEqual(["51,200"]);
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("| Acme | acme.com | software | 250 | Berlin, DE |");
  });
});
