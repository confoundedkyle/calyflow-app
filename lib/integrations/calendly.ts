import "server-only";
import type { ConnectorAdapter } from "./types";

// Calendly (scheduling). Auth is a Personal Access Token (Calendly: Integrations
// → API & Webhooks → Personal access tokens) sent as a Bearer header. The v2 API
// scopes scheduled events to a user URI, so listEvents first reads /users/me to
// get the token owner's uri, then lists their /scheduled_events; getInvitees
// reads who booked one event. Collections come back as { collection, pagination
// { next_page_token } }; the per-event uuid is the last path segment of its uri.
const API = "https://api.calendly.com";

const DEFAULT_COUNT = 20;
const HARD_COUNT = 100;
const CHAR_CAP = 12_000;

interface MeResource {
  uri?: string;
  name?: string | null;
  email?: string | null;
}

export interface CalendlyEvent {
  uri?: string;
  name?: string | null;
  status?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface CalendlyInvitee {
  name?: string | null;
  email?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface CalendlyAdapter extends ConnectorAdapter {
  listEvents(
    token: string,
    args?: { status?: string; minStartTime?: string; count?: number },
  ): Promise<{ text: string; count: number; truncated: boolean }>;
  getInvitees(
    token: string,
    args: { eventUuid: string },
  ): Promise<{ text: string; count: number }>;
}

async function get<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {}))
    if (v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json as { message?: string } | null)?.message ??
      (json as { title?: string } | null)?.title ??
      res.statusText;
    throw new Error(`Calendly error (${res.status}): ${detail}`);
  }
  return json as T;
}

function cell(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** The per-event uuid is the last path segment of its uri. */
function uuidOf(uri: string | null | undefined): string {
  if (!uri) return "";
  return uri.split("/").filter(Boolean).pop() ?? "";
}

async function me(token: string): Promise<MeResource> {
  const json = await get<{ resource?: MeResource }>(token, "/users/me");
  return json.resource ?? {};
}

export const calendlyAdapter: CalendlyAdapter = {
  provider: "calendly",
  authType: "apikey",

  async validateApiKey(token) {
    try {
      const resource = await me(token);
      const label = resource.name ?? resource.email;
      return { ok: true, accountLabel: label ? `Calendly (${label})` : "Calendly" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  async listEvents(token, args) {
    const count = Math.min(args?.count ?? DEFAULT_COUNT, HARD_COUNT);
    const owner = await me(token);
    if (!owner.uri) {
      return { text: "Couldn't resolve the Calendly user.", count: 0, truncated: false };
    }
    const json = await get<{
      collection?: CalendlyEvent[];
      pagination?: { next_page_token?: string | null } | null;
    }>(token, "/scheduled_events", {
      user: owner.uri,
      status: args?.status,
      min_start_time: args?.minStartTime,
      count,
      sort: "start_time:desc",
    });
    const events = json.collection ?? [];
    const lines = [
      "| Event | Status | Start | End | Event UUID |",
      "| --- | --- | --- | --- | --- |",
    ];
    let truncated = false;
    for (const e of events) {
      lines.push(
        `| ${cell(e.name)} | ${cell(e.status)} | ${cell(
          (e.start_time ?? "").slice(0, 16).replace("T", " "),
        )} | ${cell((e.end_time ?? "").slice(0, 16).replace("T", " "))} | ${cell(
          uuidOf(e.uri),
        )} |`,
      );
      if (lines.join("\n").length > CHAR_CAP) {
        truncated = true;
        break;
      }
    }
    const more = !!json.pagination?.next_page_token;
    return {
      text: events.length
        ? `${lines.join("\n")}${more ? "\n\n_More available — narrow with minStartTime or status._" : ""}`
        : "_No scheduled events._",
      count: events.length,
      truncated: truncated || more,
    };
  },

  async getInvitees(token, args) {
    if (!args.eventUuid) return { text: "Provide the eventUuid.", count: 0 };
    const json = await get<{ collection?: CalendlyInvitee[] }>(
      token,
      `/scheduled_events/${encodeURIComponent(args.eventUuid)}/invitees`,
      { count: HARD_COUNT },
    );
    const invitees = json.collection ?? [];
    const lines = [
      "| Name | Email | Status | Booked |",
      "| --- | --- | --- | --- |",
    ];
    for (const i of invitees) {
      lines.push(
        `| ${cell(i.name)} | ${cell(i.email)} | ${cell(i.status)} | ${cell(
          (i.created_at ?? "").slice(0, 10),
        )} |`,
      );
    }
    return {
      text: invitees.length ? lines.join("\n") : "_No invitees on that event._",
      count: invitees.length,
    };
  },
};
