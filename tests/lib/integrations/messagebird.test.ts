import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagebirdAdapter } from "@/lib/integrations/messagebird";
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
  it("sends the AccessKey authorization header to /messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await messagebirdAdapter.listMessages("my-key");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://rest.messagebird.com/messages?limit=25");
    expect(headers.Authorization).toBe("AccessKey my-key");
  });

  it("throws on a non-2xx response using the errors[].description", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ description: "incorrect access_key" }] }, 401),
    );
    await expect(messagebirdAdapter.listMessages("bad")).rejects.toThrow(
      "MessageBird error (401): incorrect access_key",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(messagebirdAdapter.listMessages("k")).rejects.toThrow(
      /MessageBird error \(500\)/,
    );
  });
});

describe("validateApiKey", () => {
  it("labels the account with the balance", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ amount: 42, type: "credits" }));
    const result = await messagebirdAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://rest.messagebird.com/balance");
    expect(result).toEqual({ ok: true, accountLabel: "MessageBird (42 credits)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ description: "incorrect access_key" }] }, 401),
    );
    const result = await messagebirdAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("incorrect access_key");
  });
});

describe("listMessages", () => {
  it("renders messages, mapping direction and reading the recipient, with more-pages", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        offset: 0,
        totalCount: 5,
        items: [
          {
            id: "m1",
            direction: "mt",
            originator: "Calyflow",
            body: "Hi there",
            createdDatetime: "2026-06-01T10:00:00+00:00",
            recipients: { items: [{ recipient: 14155550001 }] },
          },
        ],
      }),
    );
    const result = await messagebirdAdapter.listMessages("k", { limit: 1 });
    expect(result.count).toBe(1);
    expect(result.text).toContain("| outbound | Calyflow | 14155550001 | Hi there | 2026-06-01T10:00 |");
    expect(result.truncated).toBe(true);
  });

  it("maps inbound direction (mo)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        items: [{ direction: "mo", originator: "14155550001", body: "yes", recipients: { items: [] } }],
      }),
    );
    const result = await messagebirdAdapter.listMessages("k");
    expect(result.text).toContain("| inbound | 14155550001 |");
  });

  it("renders a placeholder when there are no messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const result = await messagebirdAdapter.listMessages("k");
    expect(result.text).toBe("_No messages._");
  });

  it("clamps the limit to 50", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await messagebirdAdapter.listMessages("k", { limit: 999 });
    expect(requestAt(0).url).toContain("limit=50");
  });
});
