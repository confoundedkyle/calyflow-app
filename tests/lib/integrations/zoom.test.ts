import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zoomAdapter } from "@/lib/integrations/zoom";
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
  init: RequestInit;
  headers: Record<string, string>;
} {
  const [url, init] = fetchMock.mock.calls[index];
  return { url, init, headers: (init as RequestInit).headers as Record<string, string> };
}

function tokenResponse() {
  return jsonResponse({ access_token: "tok-abc", token_type: "bearer", expires_in: 3600 });
}

describe("token exchange and credential parsing", () => {
  it("exchanges the account-credentials grant with Basic auth before calling the API", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ meetings: [] }));
    await zoomAdapter.listRecordings("acct-1:cid:secret", {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    });
    const token = requestAt(0);
    expect(token.url).toBe(
      "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=acct-1",
    );
    expect(token.init.method).toBe("POST");
    expect(token.headers.Authorization).toBe(
      `Basic ${Buffer.from("cid:secret").toString("base64")}`,
    );
    const api = requestAt(1);
    expect(api.url).toBe(
      "https://api.zoom.us/v2/users/me/recordings?from=2026-06-01&to=2026-06-30&page_size=25",
    );
    expect(api.headers.Authorization).toBe("Bearer tok-abc");
  });

  it("rejects a malformed credential without any network call", async () => {
    const result = await zoomAdapter.validateApiKey!("only-one-part");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("account-id:client-id:client-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a credential rejection from the token endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ reason: "Invalid client" }, 400));
    await expect(
      zoomAdapter.listRecordings("acct-2:cid:bad"),
    ).rejects.toThrow("Zoom rejected the credentials (400): Invalid client");
  });
});

describe("validateApiKey", () => {
  it("labels the account from /users/me", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: "rec@agency.com", account_id: "a" }));
    const result = await zoomAdapter.validateApiKey!("acct-3:cid:secret");
    expect(requestAt(1).url).toBe("https://api.zoom.us/v2/users/me");
    expect(result).toEqual({ ok: true, accountLabel: "Zoom (rec@agency.com)" });
  });
});

describe("listRecordings", () => {
  it("renders recordings and flags which have a transcript", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        meetings: [
          {
            uuid: "abc==",
            id: 123,
            topic: "Interview — Ada",
            start_time: "2026-06-10T15:00:00Z",
            duration: 45,
            share_url: "https://zoom.us/rec/share/xyz",
            recording_files: [
              { file_type: "MP4" },
              { file_type: "TRANSCRIPT", download_url: "https://api.zoom.us/dl/t" },
            ],
          },
        ],
        next_page_token: "",
      }),
    );
    const result = await zoomAdapter.listRecordings("acct-4:cid:secret", {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    });
    expect(result.count).toBe(1);
    expect(result.text).toContain(
      "| Interview — Ada | 2026-06-10 | 45 | yes | abc== | https://zoom.us/rec/share/xyz |",
    );
  });

  it("renders a placeholder when there are no recordings", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ meetings: [] }));
    const result = await zoomAdapter.listRecordings("acct-5:cid:secret");
    expect(result.text).toBe("_No recordings in this window._");
    expect(result.count).toBe(0);
  });

  it("defaults to a 30-day window when no dates are given", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ meetings: [] }));
    await zoomAdapter.listRecordings("acct-6:cid:secret");
    const url = requestAt(1).url;
    expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}/);
  });
});

describe("getTranscript", () => {
  it("downloads and parses the WEBVTT transcript file", async () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.000 --> 00:00:03.000",
      "Ada Lovelace: Hello there.",
      "",
      "2",
      "00:00:03.000 --> 00:00:05.000",
      "Bo: Hi Ada.",
    ].join("\n");
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        recording_files: [
          { file_type: "MP4", download_url: "https://api.zoom.us/dl/v" },
          { file_type: "TRANSCRIPT", download_url: "https://api.zoom.us/dl/t" },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(textResponse(vtt));
    const result = await zoomAdapter.getTranscript("acct-7:cid:secret", { meetingUuid: "abc==" });
    expect(result.found).toBe(true);
    expect(result.text).toBe("Ada Lovelace: Hello there.\nBo: Hi Ada.");
    // The transcript file is downloaded with the Bearer token.
    expect(requestAt(2).url).toBe("https://api.zoom.us/dl/t");
    expect(requestAt(2).headers.Authorization).toBe("Bearer tok-abc");
  });

  it("double-encodes a meeting uuid that starts with a slash", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ recording_files: [] }));
    await zoomAdapter.getTranscript("acct-8:cid:secret", { meetingUuid: "/abc+/d==" });
    expect(requestAt(1).url).toBe(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(encodeURIComponent("/abc+/d=="))}/recordings`,
    );
  });

  it("reports when no transcript file is present", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ recording_files: [{ file_type: "MP4" }] }));
    const result = await zoomAdapter.getTranscript("acct-9:cid:secret", { meetingUuid: "abc==" });
    expect(result.found).toBe(false);
    expect(result.text).toContain("No transcript");
  });

  it("requires a meetingUuid", async () => {
    const result = await zoomAdapter.getTranscript("acct-10:cid:secret", { meetingUuid: "" });
    expect(result.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
