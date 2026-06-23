import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discordAdapter } from "@/lib/integrations/discord";
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
  it("sends the Bot authorization header to the channels endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await discordAdapter.listChannels("tok", { guildId: "123" });
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://discord.com/api/v10/guilds/123/channels");
    expect(headers.Authorization).toBe("Bot tok");
  });

  it("throws on a non-2xx response using the message field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "401: Unauthorized" }, 401));
    await expect(
      discordAdapter.listMessages("bad", { channelId: "c1" }),
    ).rejects.toThrow("Discord error (401): 401: Unauthorized");
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      discordAdapter.listMessages("k", { channelId: "c1" }),
    ).rejects.toThrow(/Discord error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the connection with the bot name", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ username: "calyflow-bot", global_name: "Calyflow" }));
    const result = await discordAdapter.validateApiKey!("tok");
    expect(requestAt(0).url).toBe("https://discord.com/api/v10/users/@me");
    expect(result).toEqual({ ok: true, accountLabel: "Discord (Calyflow)" });
  });

  it("returns the failure message for a rejected token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "401: Unauthorized" }, 401));
    const result = await discordAdapter.validateApiKey!("tok");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Discord error (401)");
  });
});

describe("listChannels", () => {
  it("renders channels and maps the type", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "c1", name: "general", type: 0 },
        { id: "c2", name: "Voice", type: 2 },
      ]),
    );
    const result = await discordAdapter.listChannels("tok", { guildId: "g" });
    expect(result.count).toBe(2);
    expect(result.text).toContain("| general | text | c1 |");
    expect(result.text).toContain("| Voice | voice | c2 |");
  });

  it("requires a guildId", async () => {
    const result = await discordAdapter.listChannels("tok", { guildId: "" });
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listMessages", () => {
  it("renders messages, preferring global_name and clamping the limit", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "m1",
          content: "Anyone know React devs in Berlin?",
          timestamp: "2026-06-01T10:00:00.000000+00:00",
          author: { username: "ada_l", global_name: "Ada" },
        },
      ]),
    );
    const result = await discordAdapter.listMessages("tok", { channelId: "c1", limit: 999 });
    expect(requestAt(0).url).toContain("limit=50");
    expect(result.text).toContain("| Ada | Anyone know React devs in Berlin? | 2026-06-01T10:00 |");
  });

  it("falls back to username when global_name is absent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ content: "hi", timestamp: "2026-06-01T10:00:00+00:00", author: { username: "bob" } }]),
    );
    const result = await discordAdapter.listMessages("tok", { channelId: "c1" });
    expect(result.text).toContain("| bob | hi |");
  });

  it("renders a placeholder when there are no messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const result = await discordAdapter.listMessages("tok", { channelId: "c1" });
    expect(result.text).toBe("_No messages._");
  });

  it("requires a channelId", async () => {
    const result = await discordAdapter.listMessages("tok", { channelId: "" });
    expect(result.count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
