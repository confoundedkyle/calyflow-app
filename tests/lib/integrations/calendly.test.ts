import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendlyAdapter } from "@/lib/integrations/calendly";
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

function meResponse(uri = "https://api.calendly.com/users/U1") {
  return jsonResponse({ resource: { uri, name: "Rec Ruiter", email: "r@a.com" } });
}

describe("auth and errors", () => {
  it("reads /users/me then lists scoped events with a Bearer header", async () => {
    fetchMock.mockResolvedValueOnce(meResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ collection: [] }));
    await calendlyAdapter.listEvents("my-token");
    expect(requestAt(0).url).toBe("https://api.calendly.com/users/me");
    expect(requestAt(0).headers.Authorization).toBe("Bearer my-token");
    expect(requestAt(1).url).toBe(
      "https://api.calendly.com/scheduled_events?user=https%3A%2F%2Fapi.calendly.com%2Fusers%2FU1&count=20&sort=start_time%3Adesc",
    );
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Invalid token" }, 401));
    await expect(calendlyAdapter.listEvents("bad")).rejects.toThrow(
      "Calendly error (401): Invalid token",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      calendlyAdapter.getInvitees("k", { eventUuid: "E1" }),
    ).rejects.toThrow(/Calendly error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account from /users/me", async () => {
    fetchMock.mockResolvedValueOnce(meResponse());
    const result = await calendlyAdapter.validateApiKey!("k");
    expect(result).toEqual({ ok: true, accountLabel: "Calendly (Rec Ruiter)" });
  });

  it("returns the failure message for a rejected token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await calendlyAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Calendly error (401): Unauthorized");
  });
});

describe("listEvents", () => {
  it("renders events and derives the uuid from the event uri", async () => {
    fetchMock.mockResolvedValueOnce(meResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        collection: [
          {
            uri: "https://api.calendly.com/scheduled_events/EV-123",
            name: "Interview — Ada",
            status: "active",
            start_time: "2026-06-22T15:00:00.000000Z",
            end_time: "2026-06-22T15:30:00.000000Z",
          },
        ],
        pagination: { next_page_token: null },
      }),
    );
    const result = await calendlyAdapter.listEvents("k", { status: "active" });
    expect(requestAt(1).url).toContain("status=active");
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Interview — Ada | active | 2026-06-22 15:00 | 2026-06-22 15:30 | EV-123 |",
    );
  });

  it("renders a placeholder when there are no events", async () => {
    fetchMock.mockResolvedValueOnce(meResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ collection: [] }));
    const result = await calendlyAdapter.listEvents("k");
    expect(result.text).toBe("_No scheduled events._");
  });

  it("reports truncation from the pagination token", async () => {
    fetchMock.mockResolvedValueOnce(meResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ collection: [{ uri: "x/EV", name: "E" }], pagination: { next_page_token: "T2" } }),
    );
    const result = await calendlyAdapter.listEvents("k");
    expect(result.truncated).toBe(true);
  });
});

describe("getInvitees", () => {
  it("lists invitees for an event", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        collection: [
          { name: "Ada Lovelace", email: "ada@acme.com", status: "active", created_at: "2026-06-20T09:00:00Z" },
        ],
      }),
    );
    const result = await calendlyAdapter.getInvitees("k", { eventUuid: "EV-123" });
    expect(requestAt(0).url).toBe(
      "https://api.calendly.com/scheduled_events/EV-123/invitees?count=100",
    );
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | active | 2026-06-20 |");
  });

  it("requires an eventUuid", async () => {
    const result = await calendlyAdapter.getInvitees("k", { eventUuid: "" });
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
