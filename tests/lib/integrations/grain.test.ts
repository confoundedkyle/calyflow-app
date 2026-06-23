import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grainAdapter } from "@/lib/integrations/grain";
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
  it("sends the key as a Bearer header against the public-api base", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ recordings: [] }));
    await grainAdapter.listRecordings("my-key");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.grain.com/_/public-api/recordings");
    expect(headers.Authorization).toBe("Bearer my-key");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Invalid token" }, 401));
    await expect(grainAdapter.listRecordings("bad")).rejects.toThrow(
      "Grain error (401): Invalid token",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      grainAdapter.getTranscript("k", { recordingId: "r1" }),
    ).rejects.toThrow(/Grain error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key that can list recordings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ recordings: [] }));
    const result = await grainAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Grain" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await grainAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Grain error (401): Unauthorized");
  });
});

describe("listRecordings", () => {
  it("renders recordings and surfaces the next cursor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        recordings: [
          {
            id: "rec-1",
            title: "Interview — Ada",
            start_datetime: "2026-06-10T15:00:00Z",
            url: "https://grain.com/share/rec-1",
          },
        ],
        cursor: "NEXT99",
      }),
    );
    const result = await grainAdapter.listRecordings("k");
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Interview — Ada | 2026-06-10 | rec-1 | https://grain.com/share/rec-1 |",
    );
    expect(result.text).toContain("pass cursor: NEXT99");
    expect(result.truncated).toBe(true);
  });

  it("passes the cursor when paging", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ recordings: [] }));
    await grainAdapter.listRecordings("k", { cursor: "abc" });
    expect(requestAt(0).url).toBe(
      "https://api.grain.com/_/public-api/recordings?cursor=abc",
    );
  });

  it("renders a placeholder when there are no recordings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ recordings: [] }));
    const result = await grainAdapter.listRecordings("k");
    expect(result.text).toBe("_No recordings._");
    expect(result.truncated).toBe(false);
  });
});

describe("getTranscript", () => {
  it("renders speaker-attributed lines and requests JSON format", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "rec-1",
        transcript_json: [
          { speaker: "Ada", text: "Hello there." },
          { participant_id: 2, text: "Hi Ada." },
        ],
      }),
    );
    const result = await grainAdapter.getTranscript("k", { recordingId: "rec-1" });
    expect(requestAt(0).url).toBe(
      "https://api.grain.com/_/public-api/recordings/rec-1?transcript_format=json",
    );
    expect(result.found).toBe(true);
    expect(result.text).toContain("Ada: Hello there.");
    expect(result.text).toContain("Speaker 2: Hi Ada.");
  });

  it("falls back to raw JSON when the transcript shape is unrecognised", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "rec-1", intelligence_notes: "x" }));
    const result = await grainAdapter.getTranscript("k", { recordingId: "rec-1" });
    expect(result.found).toBe(true);
    expect(result.text).toContain("intelligence_notes");
  });

  it("requires a recordingId", async () => {
    const result = await grainAdapter.getTranscript("k", { recordingId: "" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
