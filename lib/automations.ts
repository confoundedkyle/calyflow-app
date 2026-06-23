import type { AutomationSchedule } from "./types";

/**
 * Next time an automation with the given schedule should run, after `from`.
 * Shared by the (stubbed) automation cron and the demo provisioner.
 *
 * - daily   → the next occurrence of HH:MM (UTC); defaults to 06:00.
 * - weekly  → the next occurrence of HH:MM, then a week out.
 * - hourly  → one hour after `from`.
 */
export function computeNextRun(
  schedule: AutomationSchedule | null,
  from: Date,
): Date | null {
  if (!schedule) return null;
  if (schedule.kind === "hourly") {
    return new Date(from.getTime() + 60 * 60 * 1000);
  }
  // daily / weekly — next occurrence of HH:MM
  const [h, m] = (schedule.time ?? "06:00").split(":").map((n) => Number(n));
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      Number.isFinite(h) ? h : 6,
      Number.isFinite(m) ? m : 0,
      0,
      0,
    ),
  );
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  if (schedule.kind === "weekly") {
    next.setUTCDate(next.getUTCDate() + 6); // ~a week out from `from`
  }
  return next;
}

/** Human label for a schedule, e.g. "Daily 06:00", "Weekly 06:00", "Hourly". */
export function scheduleLabel(schedule: AutomationSchedule | null): string {
  if (!schedule) return "Not scheduled";
  if (schedule.kind === "daily") return `Daily ${schedule.time ?? "06:00"}`;
  if (schedule.kind === "weekly") return `Weekly ${schedule.time ?? "06:00"}`;
  return "Hourly";
}
