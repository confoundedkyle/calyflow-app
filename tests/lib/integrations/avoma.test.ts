import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avomaAdapter } from "@/lib/integrations/avoma";
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
  it("sends the key as a Bearer header against the v1 base with a date window", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await avomaAdapter.listMeetings("my-key", { fromDate: "2026-06-01", toDate: "2026-06-07" });
    const { url, headers } = requestAt(0);
    expect(url).toBe(
      "https://api.avoma.com/v1/meetings?from_date=2026-06-01&to_date=2026-06-07&page_size=25",
    );
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the detail field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Invalid token." }, 401));
    await expect(
      avomaAdapter.listMeetings("bad", { fromDate: "2026-06-01", toDate: "2026-06-07" }),
    ).rejects.toThrow("Avoma error (401): Invalid token.");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      avomaAdapter.getTranscript("k", { meetingUuid: "m1" }),
    ).rejects.toThrow(/Avoma error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key that can list meetings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await avomaAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Avoma" });
    expect(requestAt(0).url).toContain("/meetings?from_date=");
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Unauthorized" }, 401));
    const result = await avomaAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Avoma error (401): Unauthorized");
  });
});

describe("listMeetings", () => {
  it("renders meetings with attendees and reports more pages from next", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 40,
        next: "https://api.avoma.com/v1/meetings?page=2",
        results: [
          {
            uuid: "m-1",
            subject: "Intake — Acme",
            start_at: "2026-06-03T10:00:00Z",
            url: "https://app.avoma.com/m/m-1",
            attendees: [{ email: "ada@acme.com" }, { name: "Bo" }],
          },
        ],
      }),
    );
    const result = await avomaAdapter.listMeetings("k", { fromDate: "2026-06-01", toDate: "2026-06-07" });
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Intake — Acme | 2026-06-03 | ada@acme.com; Bo | m-1 | https://app.avoma.com/m/m-1 |",
    );
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no meetings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await avomaAdapter.listMeetings("k", { fromDate: "2026-06-01", toDate: "2026-06-07" });
    expect(result.text).toBe("_No meetings in this window._");
    expect(result.count).toBe(0);
  });

  it("defaults to a 30-day window when no dates are given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await avomaAdapter.listMeetings("k");
    const url = requestAt(0).url;
    expect(url).toMatch(/from_date=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/to_date=\d{4}-\d{2}-\d{2}/);
  });
});

describe("getTranscript", () => {
  it("renders speaker-attributed lines from results[].transcript", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            transcript: [
              { speaker: "Ada", transcript: "Hi there." },
              { speaker_id: 2, text: "Hello." },
            ],
          },
        ],
      }),
    );
    const result = await avomaAdapter.getTranscript("k", { meetingUuid: "m-1" });
    expect(requestAt(0).url).toBe(
      "https://api.avoma.com/v1/transcriptions?meeting_uuid=m-1",
    );
    expect(result.found).toBe(true);
    expect(result.text).toContain("Ada: Hi there.");
    expect(result.text).toContain("Speaker 2: Hello.");
  });

  it("requires a meetingUuid", async () => {
    const result = await avomaAdapter.getTranscript("k", { meetingUuid: "" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
