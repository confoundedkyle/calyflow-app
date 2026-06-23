import "server-only";
import type { ConnectorAdapter } from "./types";

// Cal.com (open-source scheduling). Auth is an API key (Cal.com: Settings →
// Developer → API keys, prefixed cal_) sent as a Bearer token. The v2 API
// requires a dated cal-api-version header per endpoint; bookings pin to
// 2026-05-01. Bookings carry their attendees inline (name + email), so one
// list op covers "what's booked and who booked it". Responses are
// { status, data, pagination { nextCursor, hasMore } } with cursor paging.
const API = "https://api.cal.com/v2";
const BOOKINGS_VERSION = "2026-05-01";

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;
const CHAR_CAP = 12_000;

interface Attendee {
  name?: string | null;
  email?: string | null;
}

export interface CalcomBooking {
  uid?: string;
  title?: string | null;
  status?: string | null;
  start?: string | null;
  end?: string | null;
  attendees?: Attendee[] | null;
  eventType?: { slug?: string | null } | null;
}

export interface CalcomAdapter extends ConnectorAdapter {
  listBookings(
    apiKey: string,
    args?: { status?: string; limit?: number; cursor?: string },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": BOOKINGS_VERSION,
      Accept: "application/json",
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      (json as { message?: string } | null)?.message ??
      res.statusText;
    throw new Error(`Cal.com error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export const calcomAdapter: CalcomAdapter = {
  provider: "calcom",
  authType: "apikey",

  async validateApiKey(apiKey) {
    try {
      await get<unknown>(apiKey, "/bookings", { limit: 1 });
      return { ok: true, accountLabel: "Cal.com" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listBookings(apiKey, args) {
    const limit = Math.min(args?.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
    const json = await get<{
      data?: CalcomBooking[];
      pagination?: { nextCursor?: string | null; hasMore?: boolean } | null;
    }>(apiKey, "/bookings", {
      status: args?.status,
      limit,
      cursor: args?.cursor,
      sortStart: "desc",
    });
    const bookings = json.data ?? [];
    const lines = [
      "| Event | Status | Start | Attendee | Email | Booking UID |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const b of bookings) {
      const a = b.attendees?.[0];
      lines.push(
        `| ${cell(b.title ?? b.eventType?.slug)} | ${cell(b.status)} | ${cell(
          (b.start ?? "").slice(0, 16).replace("T", " "),
        )} | ${cell(a?.name)} | ${cell(a?.email)} | ${cell(b.uid)} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = json.pagination?.hasMore === true || !!json.pagination?.nextCursor;
    return {
      text: bookings.length
        ? `${lines.join("\n")}${
            more && json.pagination?.nextCursor
              ? `\n\n_More available — pass cursor: ${json.pagination.nextCursor}_`
              : ""
          }`
        : "_No bookings._",
      count: bookings.length,
      truncated: truncated || more,
    };
  },
};
