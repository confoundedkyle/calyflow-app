import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramAdapter } from "@/lib/integrations/telegram";
import { jsonResponse, textResponse } from "../../helpers/http";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function urlAt(index: number): string {
  return fetchMock.mock.calls[index][0] as string;
}

describe("auth and errors", () => {
  it("puts the bot token in the URL path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: [] }));
    await telegramAdapter.getUpdates("123:abc");
    expect(urlAt(0)).toBe("https://api.telegram.org/bot123:abc/getUpdates?limit=25");
  });

  it("throws when the body reports ok:false (HTTP 200)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, description: "Unauthorized" }));
    await expect(telegramAdapter.getUpdates("bad")).rejects.toThrow(
      "Telegram error (200): Unauthorized",
    );
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, description: "Not Found" }, 404));
    await expect(telegramAdapter.getUpdates("bad")).rejects.toThrow(
      "Telegram error (404): Not Found",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(telegramAdapter.getUpdates("k")).rejects.toThrow(/Telegram error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the connection with the bot username", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { username: "calyflow_bot", first_name: "Calyflow" } }));
    const result = await telegramAdapter.validateApiKey!("123:abc");
    expect(urlAt(0)).toBe("https://api.telegram.org/bot123:abc/getMe");
    expect(result).toEqual({ ok: true, accountLabel: "Telegram (@calyflow_bot)" });
  });

  it("returns the failure message for a rejected token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, description: "Unauthorized" }, 401));
    const result = await telegramAdapter.validateApiKey!("bad");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Telegram error (401)");
  });
});

describe("getUpdates", () => {
  it("renders messages, formatting sender, chat, and unix date", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        result: [
          {
            update_id: 1,
            message: {
              text: "Any React devs around?",
              date: 1781000000,
              from: { username: "ada_l", first_name: "Ada" },
              chat: { id: -100, title: "Talent Berlin" },
            },
          },
        ],
      }),
    );
    const result = await telegramAdapter.getUpdates("k");
    expect(result.count).toBe(1);
    expect(result.text).toContain("| @ada_l | Any React devs around? | Talent Berlin |");
  });

  it("reads edited_message and channel_post too, and skips update-only rows", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        result: [
          { update_id: 1 },
          { update_id: 2, channel_post: { text: "posted", chat: { username: "mychan" }, date: 1781000000 } },
        ],
      }),
    );
    const result = await telegramAdapter.getUpdates("k");
    expect(result.count).toBe(1);
    expect(result.text).toContain("posted");
    expect(result.text).toContain("@mychan");
  });

  it("renders a placeholder when there are no messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: [] }));
    const result = await telegramAdapter.getUpdates("k");
    expect(result.text).toBe("_No recent messages._");
  });

  it("clamps the limit to 100", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: [] }));
    await telegramAdapter.getUpdates("k", { limit: 999 });
    expect(urlAt(0)).toContain("limit=100");
  });
});
