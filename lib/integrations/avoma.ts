import "server-only";
import type { ConnectorAdapter } from "./types";

// Avoma (AI meeting assistant — records, transcribes, and summarises calls).
// Auth is a scoped API key (Avoma: Settings → API) sent as a Bearer token. The
// meetings list is Django-REST-style paginated ({ count, next, previous,
// results }) and REQUIRES a from_date/to_date window, so listMeetings defaults
// to the last 30 days when none is given. The transcript hangs off a separate
// /transcriptions lookup keyed by meeting uuid; its payload shape has varied
// across revisions (results[].transcript vs a bare transcript array, speaker
// vs speaker_id), so getTranscript reads tolerantly with a capped raw-JSON
// fallback — the same defensive approach as the Fathom adapter.
const API = "https://api.avoma.com/v1";

const DEFAULT_PAGE_SIZE = 25;
const HARD_PAGE_SIZE = 100;
const CHAR_CAP = 12_000;
const DEFAULT_WINDOW_DAYS = 30;

export interface AvomaMeeting {
  uuid?: string;
  subject?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  url?: string | null;
  organizer_email?: string | null;
  attendees?: { email?: string | null; name?: string | null }[] | null;
}

interface TranscriptEntry {
  speaker?: string | null;
  speaker_id?: number | string | null;
  speaker_name?: string | null;
  transcript?: string | null;
  text?: string | null;
}

export interface AvomaAdapter extends ConnectorAdapter {
  listMeetings(
    apiKey: string,
    args?: { fromDate?: string; toDate?: string; page?: number; pageSize?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  getTranscript(
    apiKey: string,
    args: { meetingUuid: string },
  ): Promise<{ text: string; found: boolean; truncated: boolean }>;
}

async function get<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { detail?: string } | null)?.detail ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`Avoma error (${res.status}): ${detail}`);
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

/** Avoma requires a date window; default to the last 30 days when none given. */
function dateRange(fromDate?: string, toDate?: string): { from: string; to: string } {
  if (fromDate && toDate) return { from: fromDate, to: toDate };
  const to = toDate ? new Date(toDate) : new Date();
  const from = fromDate
    ? new Date(fromDate)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { from: ymd(from), to: ymd(to) };
}

function renderLoose(value: unknown): string {
  const s = JSON.stringify(value, null, 1) ?? String(value);
  return s.length > CHAR_CAP ? `${s.slice(0, CHAR_CAP)}\n…(truncated)` : s;
}

export const avomaAdapter: AvomaAdapter = {
  provider: "avoma",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      const { from, to } = dateRange();
      await get<unknown>(apiKey, "/meetings", { from_date: from, to_date: to, page_size: 1 });
      return { ok: true, accountLabel: "Avoma" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listMeetings(apiKey, args) {
    const pageSize = Math.min(args?.pageSize ?? DEFAULT_PAGE_SIZE, HARD_PAGE_SIZE);
    const { from, to } = dateRange(args?.fromDate, args?.toDate);
    const json = await get<{ count?: number; next?: string | null; results?: AvomaMeeting[] }>(
      apiKey,
      "/meetings",
      { from_date: from, to_date: to, page: args?.page, page_size: pageSize },
    );
    const meetings = json.results ?? [];
    const lines = [
      "| Meeting | Date | Attendees | Meeting UUID | Link |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const m of meetings) {
      const attendees = (m.attendees ?? [])
        .map((a) => a.email ?? a.name ?? "")
        .filter(Boolean)
        .slice(0, 5)
        .join("; ");
      lines.push(
        `| ${cell(m.subject)} | ${cell((m.start_at ?? "").slice(0, 10))} | ${cell(
          attendees,
        )} | ${cell(m.uuid)} | ${cell(m.url)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.next;
    return {
      text: meetings.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — increment page._" : ""}`
        : "_No meetings in this window._",
      count: meetings.length,
      truncated: truncated || more,
    };
  },

  async getTranscript(apiKey, args) {
    if (!args.meetingUuid) {
      return { text: "Provide the meetingUuid.", found: false, truncated: false };
    }
    const json = await get<
      | { results?: { transcript?: TranscriptEntry[] }[] }
      | { transcript?: TranscriptEntry[] }
      | TranscriptEntry[]
    >(apiKey, "/transcriptions", { meeting_uuid: args.meetingUuid });
    const entries: TranscriptEntry[] = Array.isArray(json)
      ? json
      : ((json as { transcript?: TranscriptEntry[] }).transcript ??
        (json as { results?: { transcript?: TranscriptEntry[] }[] }).results?.[0]?.transcript ??
        []);
    if (!entries.length) {
      // Shape unknown but a body came back — surface it rather than claim empty.
      const fallback = Array.isArray(json) || !json ? null : renderLoose(json);
      return {
        text: fallback ?? "No transcript available for that meeting.",
        found: !!fallback,
        truncated: false,
      };
    }
    const lines: string[] = [];
    let truncated = false;
    for (const e of entries) {
      const who = e.speaker_name ?? e.speaker ?? (e.speaker_id != null ? `Speaker ${e.speaker_id}` : "Unknown");
      lines.push(`${who}: ${e.transcript ?? e.text ?? ""}`);
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        lines.push("…(transcript truncated)");
        break;
      }
    }
    return { text: lines.join("\n"), found: true, truncated };
  },
};
