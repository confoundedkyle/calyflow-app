import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adzunaAdapter } from "@/lib/integrations/adzuna";
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

const CRED = "app123:key456";

describe("auth and credential parsing", () => {
  it("injects app_id and app_key as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await adzunaAdapter.searchJobs(CRED, { what: "react", country: "us" });
    const url = urlAt(0);
    expect(url.origin + url.pathname).toBe("https://api.adzuna.com/v1/api/jobs/us/search/1");
    expect(url.searchParams.get("app_id")).toBe("app123");
    expect(url.searchParams.get("app_key")).toBe("key456");
    expect(url.searchParams.get("what")).toBe("react");
  });

  it("rejects a malformed credential without a network call", async () => {
    const result = await adzunaAdapter.validateApiKey!("no-colon");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("app-id:app-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the exception field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ exception: "AUTH_FAIL" }, 401));
    await expect(adzunaAdapter.searchJobs(CRED)).rejects.toThrow(
      "Adzuna error (401): AUTH_FAIL",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(adzunaAdapter.searchJobs(CRED)).rejects.toThrow(/Adzuna error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key that can run a gb search", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await adzunaAdapter.validateApiKey!(CRED);
    expect(urlAt(0).pathname).toBe("/v1/api/jobs/gb/search/1");
    expect(result).toEqual({ ok: true, accountLabel: "Adzuna" });
  });
});

describe("searchJobs", () => {
  it("renders jobs with salary range and a count header", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1234,
        mean: 55000,
        results: [
          {
            title: "React Developer",
            company: { display_name: "Acme" },
            location: { display_name: "London, UK" },
            salary_min: 50000,
            salary_max: 70000,
            created: "2026-06-20T09:00:00Z",
            redirect_url: "https://adzuna.com/job/1",
          },
        ],
      }),
    );
    const result = await adzunaAdapter.searchJobs(CRED, { what: "react" });
    expect(result.count).toBe(1);
    expect(result.text).toContain("1,234 matching jobs");
    expect(result.text).toContain(
      "| React Developer | Acme | London, UK | 50,000–70,000 | 2026-06-20 | https://adzuna.com/job/1 |",
    );
  });

  it("clamps the limit to 50 and reports truncation from the total count", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ count: 999, results: [{ title: "X" }] }),
    );
    const result = await adzunaAdapter.searchJobs(CRED, { limit: 999 });
    expect(urlAt(0).searchParams.get("results_per_page")).toBe("50");
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no jobs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 0, results: [] }));
    const result = await adzunaAdapter.searchJobs(CRED);
    expect(result.text).toBe("_No jobs found._");
  });
});

describe("salaryHistogram", () => {
  it("renders salary bands sorted ascending", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ histogram: { "30000": 120, "20000": 40, "40000": 80 } }),
    );
    const result = await adzunaAdapter.salaryHistogram(CRED, { what: "data scientist" });
    expect(urlAt(0).pathname).toBe("/v1/api/jobs/gb/histogram");
    const lines = result.text.split("\n");
    expect(lines[1]).toBe("- 20,000: 40");
    expect(lines[2]).toBe("- 30,000: 120");
    expect(lines[3]).toBe("- 40,000: 80");
  });

  it("requires a 'what' term without calling the API", async () => {
    const result = await adzunaAdapter.salaryHistogram(CRED, { what: "" });
    expect(result.text).toContain("Provide a job title");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
