import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calcomAdapter } from "@/lib/integrations/calcom";
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
  it("sends the Bearer token and the cal-api-version header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }));
    await calcomAdapter.listBookings("cal_my-key");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.cal.com/v2/bookings?limit=25&sortStart=desc");
    expect(headers.Authorization).toBe("Bearer cal_my-key");
    expect(headers["cal-api-version"]).toBe("2026-05-01");
  });

  it("throws on a non-2xx response using the error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Unauthorized" } }, 401));
    await expect(calcomAdapter.listBookings("bad")).rejects.toThrow(
      "Cal.com error (401): Unauthorized",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(calcomAdapter.listBookings("k")).rejects.toThrow(/Cal.com error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("accepts a key that can list one booking", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }));
    const result = await calcomAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.cal.com/v2/bookings?limit=1");
    expect(result).toEqual({ ok: true, accountLabel: "Cal.com" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Unauthorized" } }, 401));
    const result = await calcomAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cal.com error (401): Unauthorized");
  });
});

describe("listBookings", () => {
  it("renders bookings with the first attendee, passes status, and surfaces the cursor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        data: [
          {
            uid: "BK-1",
            title: "Interview — Ada",
            status: "upcoming",
            start: "2026-06-22T15:00:00.000Z",
            end: "2026-06-22T15:30:00.000Z",
            attendees: [{ name: "Ada Lovelace", email: "ada@acme.com" }],
            eventType: { slug: "interview" },
          },
        ],
        pagination: { nextCursor: "C2", hasMore: true },
      }),
    );
    const result = await calcomAdapter.listBookings("k", { status: "upcoming" });
    expect(requestAt(0).url).toContain("status=upcoming");
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Interview — Ada | upcoming | 2026-06-22 15:00 | Ada Lovelace | ada@acme.com | BK-1 |",
    );
    expect(result.text).toContain("pass cursor: C2");
    expect(result.truncated).toBe(true);
  });

  it("clamps the limit to 100", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }));
    await calcomAdapter.listBookings("k", { limit: 999 });
    expect(requestAt(0).url).toContain("limit=100");
  });

  it("renders a placeholder when there are no bookings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }));
    const result = await calcomAdapter.listBookings("k");
    expect(result.text).toBe("_No bookings._");
    expect(result.truncated).toBe(false);
  });
});
