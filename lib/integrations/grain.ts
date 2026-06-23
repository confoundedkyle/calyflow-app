import "server-only";
import type { ConnectorAdapter } from "./types";

// Grain (AI meeting notetaker — records, transcribes, and clips calls). Auth is
// a Personal Access Token (Grain: Settings → Integrations → Grain API) sent as
// a Bearer token. Reads use the v1 public API: GET /recordings lists recordings
// with cursor paging ({ recordings, cursor }), and
// GET /recordings/{id}?transcript_format=json returns the recording with a
// transcript array of { speaker, text } sections. The transcript field name has
// varied across revisions (transcript_json vs transcript), so getTranscript
// reads tolerantly with a capped raw-JSON fallback — the same defensive
// approach as the Avoma and Fathom adapters.
const API = "https://api.grain.com/_/public-api";

const CHAR_CAP = 12_000;

export interface GrainRecording {
  id?: string;
  title?: string | null;
  url?: string | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
}

interface TranscriptSection {
  speaker?: string | null;
  participant_id?: number | string | null;
  text?: string | null;
}

export interface GrainAdapter extends ConnectorAdapter {
  listRecordings(
    apiKey: string,
    args?: { cursor?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  getTranscript(
    apiKey: string,
    args: { recordingId: string },
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
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      res.statusText;
    throw new Error(`Grain error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderLoose(value: unknown): string {
  const s = JSON.stringify(value, null, 1) ?? String(value);
  return s.length > CHAR_CAP ? `${s.slice(0, CHAR_CAP)}\n…(truncated)` : s;
}

export const grainAdapter: GrainAdapter = {
  provider: "grain",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      await get<unknown>(apiKey, "/recordings");
      return { ok: true, accountLabel: "Grain" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listRecordings(apiKey, args) {
    const json = await get<{ recordings?: GrainRecording[]; cursor?: string | null }>(
      apiKey,
      "/recordings",
      { cursor: args?.cursor },
    );
    const recordings = Array.isArray(json)
      ? (json as GrainRecording[])
      : (json.recordings ?? []);
    const lines = [
      "| Title | Date | Recording ID | Link |",
      "| --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const r of recordings) {
      lines.push(
        `| ${cell(r.title)} | ${cell((r.start_datetime ?? "").slice(0, 10))} | ${cell(
          r.id,
        )} | ${cell(r.url)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const nextCursor = Array.isArray(json) ? null : json.cursor;
    return {
      text: recordings.length
        ? `${lines.join("\n")}${nextCursor ? `\n\n_More available — pass cursor: ${nextCursor}_` : ""}`
        : "_No recordings._",
      count: recordings.length,
      truncated: truncated || !!nextCursor,
    };
  },

  async getTranscript(apiKey, args) {
    if (!args.recordingId) {
      return { text: "Provide the recordingId.", found: false, truncated: false };
    }
    const json = await get<
      | { transcript_json?: TranscriptSection[]; transcript?: TranscriptSection[] }
      | TranscriptSection[]
    >(apiKey, `/recordings/${encodeURIComponent(args.recordingId)}`, {
      transcript_format: "json",
    });
    const sections: TranscriptSection[] = Array.isArray(json)
      ? json
      : (json.transcript_json ?? json.transcript ?? []);
    if (!sections.length) {
      // Shape unknown but a body came back — surface it rather than claim empty.
      const fallback = Array.isArray(json) || !json ? null : renderLoose(json);
      return {
        text: fallback ?? "No transcript available for that recording.",
        found: !!fallback,
        truncated: false,
      };
    }
    const lines: string[] = [];
    let truncated = false;
    for (const s of sections) {
      const who =
        s.speaker ?? (s.participant_id != null ? `Speaker ${s.participant_id}` : "Unknown");
      lines.push(`${who}: ${s.text ?? ""}`);
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        lines.push("…(transcript truncated)");
        break;
      }
    }
    return { text: lines.join("\n"), found: true, truncated };
  },
};
