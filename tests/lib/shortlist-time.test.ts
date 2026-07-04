import { describe, expect, it } from "vitest";
import { formatShortlistAddedAt } from "@/lib/shortlist-time";

describe("formatShortlistAddedAt", () => {
  it("shows same-day candidates as relative minutes", () => {
    const now = new Date("2026-07-04T18:25:00");

    expect(formatShortlistAddedAt("2026-07-04T18:24:20", now)).toBe("a minute ago");
    expect(formatShortlistAddedAt("2026-07-04T18:00:00", now)).toBe("25 minutes ago");
  });

  it("shows same-day candidates as relative hours", () => {
    const now = new Date("2026-07-04T18:25:00");

    expect(formatShortlistAddedAt("2026-07-04T15:10:00", now)).toBe("3 hours ago");
  });

  it("shows older candidates with exact date and time", () => {
    const now = new Date("2026-07-04T00:05:00");

    expect(formatShortlistAddedAt("2026-07-03T23:50:00", now)).toContain("2026");
    expect(formatShortlistAddedAt("2026-07-03T23:50:00", now)).not.toContain("minutes ago");
  });
});
