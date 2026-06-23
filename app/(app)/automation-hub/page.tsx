import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  getAutomationStats,
  listConnections,
  listWorkspaceAutomations,
} from "@/lib/queries";
import { ensureDemoAutomations } from "@/lib/demo";
import { scheduleLabel } from "@/lib/automations";
import {
  connectorLabel,
  requiredConnectorCategories,
} from "@/lib/connectors";
import { archiveAutomationAction } from "@/lib/actions/automations";
import { ButtonLink, Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import type { AutomationWithRuns } from "@/lib/types";

export const metadata = { title: "Automation Hub · Calyflow" };

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function nextRunLabel(a: AutomationWithRuns): string {
  if (!a.enabled) return "Paused";
  if (a.status === "failed") return "Retry queued";
  if (!a.next_run_at) return "—";
  const target = new Date(a.next_run_at);
  const diffMin = Math.round((target.getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return "Due now";
  if (diffMin < 60) return `In ${diffMin} min`;
  const now = new Date();
  const sameDay = target.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay)
    return `Today ${target.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (target.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Every required connector category is bound to a provider with an active
 *  connection. An automation that isn't fully connected can't run, so the Hub
 *  shows it inactive (red) regardless of its stored status. */
function isConnected(
  a: AutomationWithRuns,
  statusByProvider: Map<string, string>,
): boolean {
  return requiredConnectorCategories(a.allowed_tools ?? []).every((cat) => {
    const provider = a.connector_bindings?.[cat];
    return provider != null && statusByProvider.get(provider) === "active";
  });
}

/** "Greenhouse → Apollo" — bound providers in the library's required order. */
function connectorSubtitle(a: AutomationWithRuns): string {
  const order = a.library?.required_connectors?.map((r) => r.category) ?? [];
  const cats = order.length ? order : Object.keys(a.connector_bindings ?? {});
  const labels = cats
    .map((c) => a.connector_bindings?.[c])
    .filter((p): p is string => Boolean(p))
    .map((p) => connectorLabel(p));
  return labels.join(" → ");
}

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-mint-400",
  running: "bg-amber-400",
  failed: "bg-coral-400",
};

const RUN_SQUARE: Record<string, string> = {
  succeeded: "bg-mint-400",
  running: "bg-amber-400",
  failed: "bg-coral-400",
};

function recordCount(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/(\d[\d,]*)\s+(records?|accounts?|roles?|profiles?)/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

function StatTile({
  label,
  value,
  sub,
  tone = "mint",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "mint" | "amber";
}) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-navy-800/45">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold leading-none">{value}</span>
        {sub ? (
          <span
            className={`text-sm font-semibold ${tone === "amber" ? "text-amber-400" : "text-mint-700"}`}
          >
            {sub}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export default async function AutomationHubPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // Populate the demo Automation Hub on first visit (idempotent, no-op once the
  // workspace has any automation of its own).
  try {
    await ensureDemoAutomations(session.workspaceId, session.userId);
  } catch (err) {
    console.warn("ensureDemoAutomations failed:", err);
  }

  const [automations, stats, connections] = await Promise.all([
    listWorkspaceAutomations(session.workspaceId),
    getAutomationStats(session.workspaceId),
    listConnections(session.workspaceId),
  ]);
  const statusByProvider = new Map(connections.map((c) => [c.provider, c.status]));

  return (
    <>
      <p className="mb-1 text-sm text-navy-800/45">
        {session.workspace.name} / Automation Hub
      </p>
      <PageHeader
        title="Automation Hub"
        description="Configure autonomous automations from the library — bind your ATS, CRM, and enrichment tools, set a schedule, and let them run."
        action={
          <ButtonLink href="/automation-hub/library" variant="small">
            Add automation
          </ButtonLink>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Active automations"
          value={String(stats.activeCount)}
          sub={stats.activeCount ? "running autonomously" : undefined}
        />
        <StatTile
          label="Runs today"
          value={String(stats.runsToday)}
          sub={stats.successPct != null ? `${stats.successPct}% success` : undefined}
        />
        <StatTile
          label="Needs attention"
          value={String(stats.needsAttention.count)}
          sub={stats.needsAttention.firstName ?? undefined}
          tone="amber"
        />
      </div>

      {automations.length === 0 ? (
        <EmptyState
          title="No automations yet"
          description="Pick one from the library, bind your connectors, and set it running on a schedule."
          action={
            <ButtonLink href="/automation-hub/library">
              Browse the library
            </ButtonLink>
          }
        />
      ) : (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-navy-800/8 px-5 py-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-navy-800/45">
              Scheduled automations
            </h2>
            <span className="flex items-center gap-1.5 text-xs font-medium text-mint-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-mint-400" />
              live
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-navy-800/40">
                  <th className="px-5 py-2.5 font-semibold">Automation</th>
                  <th className="px-3 py-2.5 font-semibold">Schedule</th>
                  <th className="px-3 py-2.5 font-semibold">Last run</th>
                  <th className="px-3 py-2.5 font-semibold">Recent</th>
                  <th className="px-3 py-2.5 font-semibold">Next run</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {automations.map((a) => {
                  const subtitle = connectorSubtitle(a);
                  const count = recordCount(a.lastRun?.output_text ?? null);
                  const connected = isConnected(a, statusByProvider);
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-navy-800/6 align-middle"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${connected ? (STATUS_DOT[a.status] ?? "bg-navy-800/20") : "bg-coral-400"}`}
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/automation-hub/${a.id}/configure`}
                              className="font-semibold text-navy-900 hover:text-mint-700"
                            >
                              {a.name}
                            </Link>
                            {subtitle ? (
                              <p className="truncate text-xs text-navy-800/45">
                                {subtitle}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <Chip
                          tone={
                            a.schedule?.kind === "weekly"
                              ? "lavender"
                              : a.schedule?.kind === "hourly"
                                ? "sky"
                                : "navy"
                          }
                        >
                          {scheduleLabel(a.schedule)}
                        </Chip>
                      </td>
                      <td className="px-3 py-3.5">
                        {!connected ? (
                          <span className="text-navy-800/35">—</span>
                        ) : a.lastRun?.status === "failed" ? (
                          <span className="font-semibold text-coral-400">
                            Failed · {a.lastRun.error_message ?? "error"}
                          </span>
                        ) : a.lastRun ? (
                          <span className="text-navy-800/60">
                            {relativeTime(a.lastRun.created_at)}
                            {count ? ` · ${count}` : ""}
                          </span>
                        ) : (
                          <span className="text-navy-800/35">Never run</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1">
                          {!connected ? (
                            // Not connected — can't run; show blocked (red) squares.
                            Array.from({ length: 4 }).map((_, i) => (
                              <span
                                key={i}
                                className="h-3.5 w-3.5 rounded-sm bg-coral-400"
                                title="Not connected"
                              />
                            ))
                          ) : a.recentStatuses.length === 0 ? (
                            <span className="text-xs text-navy-800/30">—</span>
                          ) : (
                            a.recentStatuses.map((s, i) => (
                              <span
                                key={i}
                                className={`h-3.5 w-3.5 rounded-sm ${RUN_SQUARE[s] ?? "bg-navy-800/15"}`}
                                title={s}
                              />
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {!connected ? (
                          <Link
                            href={`/automation-hub/${a.id}/configure`}
                            className="font-medium text-coral-400 hover:underline"
                          >
                            Not connected
                          </Link>
                        ) : (
                          <span
                            className={
                              a.status === "failed"
                                ? "font-medium text-amber-400"
                                : "text-navy-800/60"
                            }
                          >
                            {nextRunLabel(a)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <form action={archiveAutomationAction.bind(null, a.id)}>
                          <button
                            type="submit"
                            className="rounded-chip border border-navy-800/12 px-2.5 py-1 text-xs font-medium text-navy-800/45 transition hover:border-navy-800/40 hover:text-navy-800"
                          >
                            Archive
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
