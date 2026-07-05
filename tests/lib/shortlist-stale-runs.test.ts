import { describe, expect, it } from "vitest";
import {
  staleShortlistRunCutoff,
  STALE_SHORTLIST_RUN_MESSAGE,
} from "@/lib/shortlist/stale-runs";

describe("stale shortlist runs", () => {
  it("uses a 30 minute cutoff before marking a running sourcing run stale", () => {
    const now = new Date("2026-07-05T12:00:00.000Z");

    expect(staleShortlistRunCutoff(now).toISOString()).toBe(
      "2026-07-05T11:30:00.000Z",
    );
  });

  it("tells the recruiter they can start a new run", () => {
    expect(STALE_SHORTLIST_RUN_MESSAGE).toContain("Start a new run");
  });
});
