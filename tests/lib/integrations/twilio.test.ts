import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { twilioAdapter } from "@/lib/integrations/twilio";
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

const CRED = "ACsid123:token456";

describe("auth and credential parsing", () => {
  it("puts the SID in the path and sends Basic auth (sid:token)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [] }));
    await twilioAdapter.listMessages(CRED, { to: "+14155551234" });
    const { url, headers } = requestAt(0);
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACsid123/Messages.json?PageSize=25&To=%2B14155551234",
    );
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("ACsid123:token456").toString("base64")}`,
    );
  });

  it("rejects a malformed credential without a network call", async () => {
    const result = await twilioAdapter.validateApiKey!("no-colon");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("account-sid:auth-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Authentticate" }, 401));
    await expect(twilioAdapter.listMessages(CRED)).rejects.toThrow(
      "Twilio error (401): Authentticate",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(twilioAdapter.listCalls(CRED)).rejects.toThrow(/Twilio error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account from the account resource", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ friendly_name: "Recruiting Line" }));
    const result = await twilioAdapter.validateApiKey!(CRED);
    expect(requestAt(0).url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACsid123.json",
    );
    expect(result).toEqual({ ok: true, accountLabel: "Twilio (Recruiting Line)" });
  });

  it("returns the failure message for a rejected credential", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    const result = await twilioAdapter.validateApiKey!(CRED);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Twilio error (401): Unauthorized");
  });
});

describe("listMessages", () => {
  it("renders messages and reports more from next_page_uri", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        messages: [
          {
            sid: "SM1",
            from: "+14155550001",
            to: "+14155550002",
            body: "Hi, are you still interested?",
            status: "delivered",
            direction: "outbound-api",
            date_sent: "2026-06-20T09:00:00Z",
          },
        ],
        next_page_uri: "/2010-04-01/.../Messages.json?Page=1",
      }),
    );
    const result = await twilioAdapter.listMessages(CRED);
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| +14155550001 | +14155550002 | outbound-api | delivered | Hi, are you still interested? | 2026-06-20T09:00 |",
    );
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [] }));
    const result = await twilioAdapter.listMessages(CRED);
    expect(result.text).toBe("_No messages._");
  });
});

describe("listCalls", () => {
  it("renders calls with duration and direction", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        calls: [
          {
            sid: "CA1",
            from: "+14155550001",
            to: "+14155550002",
            status: "completed",
            direction: "outbound-dial",
            duration: "182",
            start_time: "2026-06-20T10:00:00Z",
          },
        ],
      }),
    );
    const result = await twilioAdapter.listCalls(CRED);
    expect(requestAt(0).url).toContain("/Accounts/ACsid123/Calls.json");
    expect(result.text).toContain(
      "| +14155550001 | +14155550002 | outbound-dial | completed | 182 | 2026-06-20T10:00 |",
    );
  });

  it("renders a placeholder when there are no calls", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ calls: [] }));
    const result = await twilioAdapter.listCalls(CRED);
    expect(result.text).toBe("_No calls._");
  });
});
