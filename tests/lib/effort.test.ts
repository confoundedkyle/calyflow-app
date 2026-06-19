import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  effortGuidance,
  effortMaxSteps,
  parseEffort,
} from "@/lib/effort";

describe("parseEffort", () => {
  it("accepts the three valid levels", () => {
    expect(parseEffort("low")).toBe("low");
    expect(parseEffort("medium")).toBe("medium");
    expect(parseEffort("high")).toBe("high");
  });

  it("falls back to the default for anything else", () => {
    for (const bad of [undefined, null, "", "huge", 3, {}, "LOW"]) {
      expect(parseEffort(bad)).toBe(DEFAULT_EFFORT);
    }
  });
});

describe("effortMaxSteps", () => {
  it("keeps the agent's own budget at medium", () => {
    expect(effortMaxSteps(16, "medium")).toBe(16);
  });

  it("lowers the budget for low and raises it for high", () => {
    expect(effortMaxSteps(16, "low")).toBe(8);
    expect(effortMaxSteps(16, "high")).toBe(28);
  });

  it("orders low < medium < high for the same base", () => {
    const base = 12;
    expect(effortMaxSteps(base, "low")).toBeLessThan(
      effortMaxSteps(base, "medium"),
    );
    expect(effortMaxSteps(base, "medium")).toBeLessThan(
      effortMaxSteps(base, "high"),
    );
  });

  it("floors small budgets so the agent can still act", () => {
    expect(effortMaxSteps(2, "low")).toBe(4);
    expect(effortMaxSteps(null, "low")).toBeGreaterThanOrEqual(4);
  });

  it("caps high effort to stay within the run timeout", () => {
    expect(effortMaxSteps(100, "high")).toBe(36);
  });

  it("uses a sane fallback when no base budget is set", () => {
    expect(effortMaxSteps(null, "medium")).toBe(12);
    expect(effortMaxSteps(undefined, "medium")).toBe(12);
    expect(effortMaxSteps(0, "medium")).toBe(12);
  });
});

describe("effortGuidance", () => {
  it("returns a distinct, non-empty block per level", () => {
    const blocks = EFFORT_LEVELS.map((l) => effortGuidance(l.value));
    for (const b of blocks) expect(b.length).toBeGreaterThan(0);
    expect(new Set(blocks).size).toBe(EFFORT_LEVELS.length);
  });
});
