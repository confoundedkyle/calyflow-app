import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recruitcrmAdapter } from "@/lib/integrations/recruitcrm";
import { jsonResponse, textResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestAt(index: number): {
  url: string;
  headers: Record<string, string>;
} {
  const [url, init] = fetchMock.mock.calls[index];
  return { url, headers: init.headers as Record<string, string> };
}

describe("auth and errors", () => {
  it("sends a Bearer token to the candidates endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await recruitcrmAdapter.searchCandidates("my-token");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.recruitcrm.io/v1/candidates");
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("passes search and page params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await recruitcrmAdapter.searchCandidates("t", { search: "react", page: 2 });
    expect(requestAt(0).url).toBe("https://api.recruitcrm.io/v1/candidates?page=2&search=react");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthenticated." }, 401));
    await expect(recruitcrmAdapter.listJobs("bad")).rejects.toThrow(
      "Recruit CRM error (401): Unauthenticated.",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(recruitcrmAdapter.listJobs("t")).rejects.toThrow(/Recruit CRM error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a token that can list candidates", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const result = await recruitcrmAdapter.validateApiKey!("t");
    expect(requestAt(0).url).toBe("https://api.recruitcrm.io/v1/candidates");
    expect(result).toEqual({ ok: true, accountLabel: "Recruit CRM" });
  });

  it("returns the failure message for a rejected token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthenticated." }, 401));
    const result = await recruitcrmAdapter.validateApiKey!("t");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Recruit CRM error (401)");
  });
});

describe("searchCandidates", () => {
  it("renders candidates and reports more pages via next_page_url", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        next_page_url: "https://api.recruitcrm.io/v1/candidates?page=2",
        data: [
          {
            slug: "abc",
            first_name: "Ada",
            last_name: "Lovelace",
            email: "ada@acme.com",
            contact_number: "+1 555",
            position: "Engineer",
          },
        ],
      }),
    );
    const result = await recruitcrmAdapter.searchCandidates("t");
    expect(result.count).toBe(1);
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | +1 555 | Engineer | abc |");
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no candidates", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const result = await recruitcrmAdapter.searchCandidates("t");
    expect(result.text).toBe("_No candidates._");
  });
});

describe("listJobs", () => {
  it("renders jobs, reading nested company and status shapes", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            slug: "job1",
            name: "Senior React Engineer",
            company: { company_name: "Acme" },
            job_status: { label: "Open" },
            city: "Berlin",
          },
        ],
      }),
    );
    const result = await recruitcrmAdapter.listJobs("t");
    expect(result.text).toContain("| Senior React Engineer | Acme | Open | Berlin | job1 |");
  });

  it("handles a string job_status", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ name: "Role", job_status: "Closed" }] }),
    );
    const result = await recruitcrmAdapter.listJobs("t");
    expect(result.text).toContain("| Role |  | Closed |");
  });
});
