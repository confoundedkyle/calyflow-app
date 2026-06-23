import "server-only";
import type { ConnectorAdapter } from "./types";

// Zoom (cloud recordings + transcripts for interviews and intake calls). Auth
// is a Server-to-Server OAuth app: the stored credential is the user-pasted
// triple "account-id:client-id:client-secret" (Zoom: Marketplace → Build a
// Server-to-Server OAuth app), exchanged for a 1-hour Bearer token via the
// account_credentials grant — cached in-process and refreshed a minute early,
// the same pattern as the Snov.io tool. Reads are cloud recordings
// (GET /v2/users/me/recordings, from/to window) and a meeting's transcript
// (the recording_files entry with file_type TRANSCRIPT is a WEBVTT file
// downloaded with the Bearer token, then parsed to speaker-attributed lines).
const OAUTH = "https://zoom.us/oauth/token";
const API = "https://api.zoom.us/v2";

const DEFAULT_PAGE_SIZE = 25;
const HARD_PAGE_SIZE = 100;
const CHAR_CAP = 12_000;
const DEFAULT_WINDOW_DAYS = 30;
const TOKEN_SKEW_MS = 60_000;

const CREDENTIAL_HINT =
  'Paste the credential as "account-id:client-id:client-secret" — all three are shown on your Zoom Server-to-Server OAuth app under App Credentials.';

export interface ZoomRecordingFile {
  id?: string;
  file_type?: string | null;
  file_extension?: string | null;
  download_url?: string | null;
  recording_type?: string | null;
}
export interface ZoomMeeting {
  uuid?: string;
  id?: number | string;
  topic?: string | null;
  start_time?: string | null;
  duration?: number | null;
  share_url?: string | null;
  recording_files?: ZoomRecordingFile[] | null;
}

export interface ZoomAdapter extends ConnectorAdapter {
  listRecordings(
    credential: string,
    args?: { fromDate?: string; toDate?: string; pageSize?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  getTranscript(
    credential: string,
    args: { meetingUuid: string },
  ): Promise<{ text: string; found: boolean; truncated: boolean }>;
}

function parseCredential(
  credential: string,
): { accountId: string; clientId: string; clientSecret: string } | null {
  const parts = credential.split(":");
  if (parts.length < 3) return null;
  const accountId = parts[0].trim();
  const clientId = parts[1].trim();
  const clientSecret = parts.slice(2).join(":").trim();
  if (!accountId || !clientId || !clientSecret) return null;
  return { accountId, clientId, clientSecret };
}

// Account-credentials tokens last an hour; cache per account id so agent runs
// don't burn rate budget re-exchanging on every call.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken(credential: string): Promise<string> {
  const parsed = parseCredential(credential);
  if (!parsed) throw new Error(`Zoom credential is malformed. ${CREDENTIAL_HINT}`);
  const cached = tokenCache.get(parsed.accountId);
  if (cached && cached.expiresAt - TOKEN_SKEW_MS > Date.now()) return cached.token;
  const basic = Buffer.from(`${parsed.clientId}:${parsed.clientSecret}`).toString("base64");
  const res = await fetch(
    `${OAUTH}?grant_type=account_credentials&account_id=${encodeURIComponent(parsed.accountId)}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}`, Accept: "application/json" } },
  );
  const json = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    reason?: string;
    error?: string;
  } | null;
  if (!res.ok || !json?.access_token) {
    throw new Error(
      `Zoom rejected the credentials (${res.status}): ${json?.reason ?? json?.error ?? "check the account id, client id and secret"}`,
    );
  }
  tokenCache.set(parsed.accountId, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

async function apiGet<T>(
  credential: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const token = await getToken(credential);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { message?: string } | null)?.message ?? res.statusText;
    throw new Error(`Zoom error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateRange(fromDate?: string, toDate?: string): { from: string; to: string } {
  const to = toDate ? new Date(toDate) : new Date();
  const from = fromDate
    ? new Date(fromDate)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { from: ymd(from), to: ymd(to) };
}

// Zoom requires double-encoding a meeting UUID that starts with "/" or contains "//".
function encodeUuid(uuid: string): string {
  return /^\/|\/\//.test(uuid)
    ? encodeURIComponent(encodeURIComponent(uuid))
    : encodeURIComponent(uuid);
}

/** Pull spoken lines out of a Zoom WEBVTT transcript (already "Speaker: text"). */
function parseVtt(vtt: string): string[] {
  const out: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "WEBVTT") continue;
    if (line.includes("-->")) continue; // timestamp cue
    if (/^\d+$/.test(line)) continue; // cue index
    out.push(line);
  }
  return out;
}

export const zoomAdapter: ZoomAdapter = {
  provider: "zoom",
  authType: "apikey",

  async validateApiKey(credential) {
    if (!parseCredential(credential)) return { ok: false, message: CREDENTIAL_HINT };
    try {
      const me = await apiGet<{ email?: string | null; account_id?: string | null }>(
        credential,
        "/users/me",
      );
      return { ok: true, accountLabel: me.email ? `Zoom (${me.email})` : "Zoom" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listRecordings(credential, args) {
    const pageSize = Math.min(args?.pageSize ?? DEFAULT_PAGE_SIZE, HARD_PAGE_SIZE);
    const { from, to } = dateRange(args?.fromDate, args?.toDate);
    const json = await apiGet<{ meetings?: ZoomMeeting[]; next_page_token?: string | null }>(
      credential,
      "/users/me/recordings",
      { from, to, page_size: pageSize },
    );
    const meetings = json.meetings ?? [];
    const lines = [
      "| Topic | Date | Duration (min) | Transcript? | Meeting UUID | Link |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const m of meetings) {
      const hasTranscript = (m.recording_files ?? []).some(
        (f) => f.file_type === "TRANSCRIPT",
      );
      lines.push(
        `| ${cell(m.topic)} | ${cell((m.start_time ?? "").slice(0, 10))} | ${
          m.duration ?? ""
        } | ${hasTranscript ? "yes" : "no"} | ${cell(m.uuid)} | ${cell(m.share_url)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.next_page_token;
    return {
      text: meetings.length
        ? `${lines.join("\n")}${more ? "\n\n_More available in this window._" : ""}`
        : "_No recordings in this window._",
      count: meetings.length,
      truncated: truncated || more,
    };
  },

  async getTranscript(credential, args) {
    if (!args.meetingUuid) {
      return { text: "Provide the meetingUuid.", found: false, truncated: false };
    }
    const json = await apiGet<{ recording_files?: ZoomRecordingFile[] }>(
      credential,
      `/meetings/${encodeUuid(args.meetingUuid)}/recordings`,
    );
    const file = (json.recording_files ?? []).find(
      (f) => f.file_type === "TRANSCRIPT" && f.download_url,
    );
    if (!file?.download_url) {
      return {
        text: "No transcript is available for that meeting (Zoom only generates one when audio transcription is enabled).",
        found: false,
        truncated: false,
      };
    }
    // The download is a WEBVTT file, not JSON — fetch it with the Bearer token.
    const token = await getToken(credential);
    const res = await fetch(file.download_url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Zoom transcript download failed (${res.status}).`);
    }
    const vtt = await res.text();
    const entries = parseVtt(vtt);
    if (!entries.length) {
      return { text: "The transcript file was empty.", found: false, truncated: false };
    }
    let truncated = false;
    const kept: string[] = [];
    for (const line of entries) {
      kept.push(line);
      if (kept.join("\n").length > CHAR_CAP) {
        truncated = true;
        kept.push("…(transcript truncated)");
        break;
      }
    }
    return { text: kept.join("\n"), found: true, truncated };
  },
};
