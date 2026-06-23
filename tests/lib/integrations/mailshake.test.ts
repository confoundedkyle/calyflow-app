import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailshakeAdapter } from "@/lib/integrations/mailshake";
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
  it("sends the api key as basic auth with an empty password", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await mailshakeAdapter.listCampaigns("my-key");
    const { url, headers } = requestAt(0);
    expect(url).toBe("https://api.mailshake.com/2017-04-01/campaigns/list?perPage=25");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("my-key:").toString("base64")}`,
    );
  });

  it("throws on a non-2xx response using the error field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid key" }, 401));
    await expect(mailshakeAdapter.listCampaigns("bad")).rejects.toThrow(
      "Mailshake error (401): invalid key",
    );
  });

  it("falls back to status text when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(
      mailshakeAdapter.listRecipients("k", { campaignId: 1 }),
    ).rejects.toThrow(/Mailshake error \(500\)/);
  });
});

describe("validateApiKey", () => {
  it("labels the account from /me (user envelope)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ user: { fullName: "Rec Ruiter", emailAddress: "r@a.com" } }),
    );
    const result = await mailshakeAdapter.validateApiKey!("k");
    expect(requestAt(0).url).toBe("https://api.mailshake.com/2017-04-01/me");
    expect(result).toEqual({ ok: true, accountLabel: "Mailshake (Rec Ruiter)" });
  });

  it("returns the failure message for a rejected key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    const result = await mailshakeAdapter.validateApiKey!("k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Mailshake error (401): Unauthorized");
  });
});

describe("listCampaigns", () => {
  it("renders campaigns and surfaces the nextToken", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          { id: 7, title: "Q3 Outbound", created: "2026-06-01T10:00:00Z", archived: null },
        ],
        nextToken: "TOK2",
      }),
    );
    const result = await mailshakeAdapter.listCampaigns("k", { search: "Q3" });
    expect(requestAt(0).url).toContain("search=Q3");
    expect(result.count).toBe(1);
    expect(result.text).toContain("| Q3 Outbound | 2026-06-01 | no | 7 |");
    expect(result.text).toContain("pass nextToken: TOK2");
    expect(result.truncated).toBe(true);
  });

  it("renders a placeholder when there are no campaigns", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await mailshakeAdapter.listCampaigns("k");
    expect(result.text).toBe("_No campaigns._");
  });
});

describe("listRecipients", () => {
  it("requires a campaignId without calling the API", async () => {
    const result = await mailshakeAdapter.listRecipients("k", { campaignId: 0 });
    expect(result.count).toBe(0);
    expect(result.text).toContain("Provide a campaignId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders recipients scoped to a campaign", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          { id: 11, fullName: "Ada Lovelace", emailAddress: "ada@acme.com", created: "2026-06-05T00:00:00Z" },
        ],
      }),
    );
    const result = await mailshakeAdapter.listRecipients("k", { campaignId: 7 });
    expect(requestAt(0).url).toBe(
      "https://api.mailshake.com/2017-04-01/recipients/list?campaignID=7&perPage=25",
    );
    expect(result.text).toContain("| Ada Lovelace | ada@acme.com | 2026-06-05 | 11 |");
  });

  it("renders a placeholder when the campaign has no recipients", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await mailshakeAdapter.listRecipients("k", { campaignId: 7 });
    expect(result.text).toBe("_No recipients in that campaign._");
  });
});
